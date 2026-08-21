import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer as createHttpServer, type Server } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, afterAll, beforeAll, expect, it } from 'vitest';
import { toOrchestratorInput } from '../local-executor';
import { validateConfig } from '../config/validate';
import { runCli } from '../index';
import { VALID_CONFIG } from './fixtures';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../../../..');
const appDir = resolve(root, 'test-fixtures/reference-auth-app');
const temporaryDirectories: string[] = [];
let targetServer: Server | undefined;
let assetServer: Server | undefined;
let targetOrigin = '';
let assetOrigin = '';
let assetHits = 0;
let sourceDirectory = '';
let commit = '';

/**
 * DG-289 C-4 / AC-5 (#289, DECISION issuecomment-5360240026): the AC-5
 * binary, proven through the FULL CLI source path (runCli → LocalRunExecutor
 * → OrchestratorInput → orchestrator discovery → crawl origin gate):
 *
 *   DECLARED — config.target.allowedOrigins carries a second loopback origin
 *   whose asset the target page references → the crawl origin gate permits
 *   the asset (the asset server records the hit; no abort diagnostic).
 *
 *   ABSENT — allowedOrigins carries only the target origin (and, separately,
 *   a config WITHOUT the field is rejected at validation) → the gate refuses
 *   the second origin's asset exactly as at baseline (abort diagnostic
 *   recorded, zero asset hits) — fail-closed default, byte-identical.
 */
describe('allowedOrigins runtime origin gates through the CLI source path (DG-289 AC-5)', () => {
  beforeAll(async () => {
    // Two loopback origins: the crawl target (serves the app page + the
    // attestation well-known) and the second origin (serves the asset the
    // page references). Real Chromium fetches the asset during the crawl, so
    // the gate decision is observable on the wire (hit counter + diagnostics).
    assetServer = await startAssetServer();
    targetServer = await startTargetServer();
    sourceDirectory = await committedFixtureCopy();
  }, 120_000);

  afterAll(async () => {
    await stopServer(targetServer);
    await stopServer(assetServer);
    await Promise.all(
      temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('DECLARED: a second loopback origin in target.allowedOrigins is permitted by the crawl origin gate', async () => {
    const outDir = await temporaryDirectory('arxic-allowed-origins-declared-');
    const configPath = await writeConfig(join(outDir, 'config'), [targetOrigin, assetOrigin]);
    const result = await runNoModelCrawl(configPath, outDir, 'allowed-origins-declared');
    const { surface, diagnostics } = result;

    expect(surface.routes.map((route) => route.path)).toEqual(
      expect.arrayContaining(['/', '/about']),
    );
    expect(assetHits, 'the declared origin asset must actually be fetched').toBeGreaterThanOrEqual(
      1,
    );
    expect(
      diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === 'ARXIC-SURFACE-001' && diagnostic.subject.startsWith(assetOrigin),
      ),
      'a DECLARED origin must not be aborted by the crawl origin gate',
    ).toEqual([]);
    expect(diagnostics.filter((diagnostic) => diagnostic.code === 'ARXIC-SURFACE-005')).toEqual([]);
  }, 300_000);

  it('ABSENT: without the declaration the gate refuses the second origin exactly as at baseline (fail-closed)', async () => {
    const outDir = await temporaryDirectory('arxic-allowed-origins-absent-');
    const configPath = await writeConfig(join(outDir, 'config'), [targetOrigin]);
    const hitsBefore = assetHits;
    const result = await runNoModelCrawl(configPath, outDir, 'allowed-origins-absent');
    const { surface, diagnostics } = result;

    expect(surface.routes.map((route) => route.path)).toEqual(
      expect.arrayContaining(['/', '/about']),
    );
    expect(assetHits, 'an UNDECLARED origin must never be fetched').toBe(hitsBefore);
    expect(
      diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === 'ARXIC-SURFACE-001' &&
          diagnostic.subject.startsWith(`${assetOrigin}/`),
      ),
      'the undeclared origin asset must be aborted with the existing external-origin diagnostic',
    ).toHaveLength(1);
  }, 300_000);

  describe('config validation and forwarding (SP-2 fast paths)', () => {
    it('malformed or absent allowedOrigins declarations are rejected at config validation', () => {
      const malformed = validateConfig({
        ...VALID_CONFIG,
        target: { ...VALID_CONFIG.target, allowedOrigins: ['not-a-url'] },
      });
      expect(malformed.ok).toBe(false);
      if (!malformed.ok) {
        expect(malformed.diagnostics).toContainEqual(
          expect.objectContaining({ subject: 'config.target.allowedOrigins' }),
        );
      }

      const absent = validateConfig({
        ...VALID_CONFIG,
        target: { ...VALID_CONFIG.target, allowedOrigins: undefined },
      });
      expect(absent.ok).toBe(false);
      if (!absent.ok) {
        expect(absent.diagnostics).toContainEqual(
          expect.objectContaining({ subject: 'config.target.allowedOrigins' }),
        );
      }
    });

    it('toOrchestratorInput forwards config.target.allowedOrigins into OrchestratorInput', () => {
      const input = toOrchestratorInput({
        runId: 'allowed-origins-unit',
        config: VALID_CONFIG,
        runDirectory: '/tmp/arxic-unused',
        rulepacksDir: '/tmp/arxic-rulepacks',
      });
      expect(input.allowedOrigins).toEqual(['http://127.0.0.1:1', 'http://127.0.0.1:2']);
    });
  });
});

type CrawlOutcome = {
  surface: { routes: Array<{ path: string }> };
  diagnostics: Array<{ code: string; subject: string }>;
  exitCode: number;
};

async function runNoModelCrawl(
  configPath: string,
  outDir: string,
  runId: string,
): Promise<CrawlOutcome> {
  const previous = {
    ARXIC_MODEL_BASE_URL: process.env.ARXIC_MODEL_BASE_URL,
    ARXIC_MODEL_API_KEY: process.env.ARXIC_MODEL_API_KEY,
    ARXIC_STATE_DIR: process.env.ARXIC_STATE_DIR,
  };
  delete process.env.ARXIC_MODEL_BASE_URL;
  delete process.env.ARXIC_MODEL_API_KEY;
  process.env.ARXIC_STATE_DIR = join(outDir, 'state');
  try {
    const result = await runCli(
      ['run', '--config', configPath, '--out', outDir, '--run-id', runId],
      {
        cwd: root,
        rulepacksDir: resolve(root, 'rulepacks'),
        stdout: { write: () => undefined },
        stderr: { write: () => undefined },
        now: () => new Date().toISOString(),
      },
    );
    const runRoot = result.runDirectory!;
    const surface = JSON.parse(
      await readFile(join(runRoot, 'artifacts', '05.json'), 'utf8'),
    ) as CrawlOutcome['surface'];
    const diagnostics = (await readFile(join(runRoot, 'diagnostics.jsonl'), 'utf8'))
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as CrawlOutcome['diagnostics'][number]);
    return { surface, diagnostics, exitCode: result.exitCode };
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function writeConfig(directory: string, allowedOrigins: string[]): Promise<string> {
  await mkdir(directory, { recursive: true });
  const configPath = join(directory, 'arxic.yaml');
  await writeFile(
    configPath,
    `version: 1
source:
  repository: ${JSON.stringify(sourceDirectory)}
  revision: ${JSON.stringify(commit)}
  languages: [typescript, javascript]
scope:
  domains: [authentication]
  frameworks: [nextjs]
  browsers: [chromium]
  personas: [anonymous, registered-user]
target:
  origin: ${JSON.stringify(targetOrigin)}
  environmentClass: local-test
  attestationPath: /.well-known/arxic-test-target.json
  allowedOrigins:
${allowedOrigins.map((entry) => `    - ${JSON.stringify(entry)}`).join('\n')}
policy:
  maxUrls: 8
  maxDepth: 1
  maxRuntimeMinutes: 30
  mutation: leased-fixtures-only
  externalNetwork: deny
  requiredVerificationRuns: 2
  screenshots: transition-checkpoints
  trace: retain
  humanApproval: [destructive, external-side-effect]
fixtures:
  personaProvisioner: app-seed-api
models:
  provider: configured-adapter
  sourceRetention: disabled
`,
    'utf8',
  );
  return configPath;
}

function pageHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <title>Allowed Origins Fixture</title>
    <script src="${assetOrigin}/asset.js"></script>
  </head>
  <body>
    <h1>Allowed Origins Fixture</h1>
    <a href="/about">about</a>
  </body>
</html>`;
}

async function startTargetServer(): Promise<Server> {
  const port = await freePort();
  targetOrigin = `http://127.0.0.1:${port}`;
  const buildDigest = createHash('sha256').update('arxic-allowed-origins-fixture-v1').digest('hex');
  const server = createHttpServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0];
    if (path === '/.well-known/arxic-test-target.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          environmentClass: 'local-test',
          origin: targetOrigin,
          allowedOrigins: [targetOrigin],
          buildDigest,
          nonce: 'allowed-origins-fixture',
        }),
      );
      return;
    }
    if (path === '/' || path === '/about') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(pageHtml());
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
  });
  await listen(server, port);
  return server;
}

async function startAssetServer(): Promise<Server> {
  const port = await freePort();
  assetOrigin = `http://127.0.0.1:${port}`;
  const server = createHttpServer((request, response) => {
    assetHits += 1;
    response.writeHead(200, { 'content-type': 'application/javascript' });
    response.end('// arxic allowed-origins fixture asset\n');
  });
  await listen(server, port);
  return server;
}

async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, '127.0.0.1', resolveListen);
  });
}

async function committedFixtureCopy(): Promise<string> {
  const stagingDirectory = await temporaryDirectory('arxic-allowed-origins-stage-');
  await cp(appDir, stagingDirectory, {
    recursive: true,
    filter: (path) => !['node_modules', '.next', 'dist'].includes(basename(path)),
  });
  const directory = await temporaryDirectory('arxic-allowed-origins-source-');
  await cp(stagingDirectory, directory, {
    recursive: true,
    filter: (path) => {
      const name = basename(path);
      return (
        !['node_modules', '.next', 'dist'].includes(name) &&
        !name.startsWith('.vitest-auth.db') &&
        !name.startsWith('auth.db')
      );
    },
  });
  await writeFile(join(directory, '.gitignore'), 'node_modules/\n.next/\ndist/\nauth.db*\n');
  const environment = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Arxic Test',
    GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
    GIT_COMMITTER_NAME: 'Arxic Test',
    GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
  };
  await execute('git', ['init', '--initial-branch=main'], { cwd: directory, env: environment });
  await execute('git', ['add', '.'], { cwd: directory, env: environment });
  await execute('git', ['commit', '-m', 'reference fixture'], { cwd: directory, env: environment });
  commit = (await execute('git', ['rev-parse', 'HEAD'], { cwd: directory })).stdout.trim();
  return directory;
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate a port');
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return address.port;
}

async function stopServer(server: Server | undefined): Promise<void> {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}
