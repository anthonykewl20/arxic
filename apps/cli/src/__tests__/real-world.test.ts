import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { validateDiagnostic, type Diagnostic } from '@arxic/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from '../index';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../../../..');
const appDir = resolve(root, 'test-fixtures/reference-auth-app');
const temporaryDirectories: string[] = [];
let app: ChildProcess | undefined;
let origin = '';
let sourceDirectory = '';
let commit = '';
let configPath = '';
let modelServer: HttpServer | undefined;
let modelBaseUrl = '';

describe('real CLI pipeline proof', () => {
  beforeAll(async () => {
    await execute('pnpm', ['--filter', 'reference-auth-app', 'build'], {
      cwd: root,
      timeout: 180_000,
    });
    sourceDirectory = await committedFixtureCopy();
    const runtime = await temporaryDirectory('arxic-m1-11-runtime-');
    const configDirectory = await temporaryDirectory('arxic-m1-11-config-');
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    app = spawn(
      process.execPath,
      [resolve(appDir, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)],
      {
        cwd: appDir,
        env: {
          ...process.env,
          ARXIC_TARGET_ORIGIN: origin,
          ARXIC_ATTESTATION_NONCE: 'm1-11-real-world-proof',
          ARXIC_DB_PATH: join(runtime, 'auth.db'),
        },
        stdio: 'ignore',
        shell: false,
      },
    );
    await readiness(origin, app);
    expect((await fetch(`${origin}/__arxic/reset`, { method: 'POST' })).status).toBe(204);
    expect(
      (
        await fetch(`${origin}/__arxic/seed`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            personaId: 'm1-11-user',
            email: 'm1-11@example.test',
            password: 'Hunter2!',
          }),
        })
      ).status,
    ).toBe(201);
    configPath = join(configDirectory, 'arxic.yaml');
    await writeConfig(configPath, origin);
    ({ server: modelServer, baseUrl: modelBaseUrl } = await startModelEndpoint());
  }, 240_000);

  afterAll(async () => {
    await stop(app);
    await stopServer(modelServer);
    await Promise.all(
      temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('writes an observable run directory after driving the real pipeline and reference app', async () => {
    const outDir = await temporaryDirectory('arxic-m1-11-runs-');
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const previous = modelEnvironment();
    delete process.env.ARXIC_MODEL_BASE_URL;
    delete process.env.ARXIC_MODEL_API_KEY;
    let result: Awaited<ReturnType<typeof runCli>>;
    try {
      result = await runCli(
        ['run', '--config', configPath, '--out', outDir, '--run-id', 'm1-11-real'],
        {
          cwd: root,
          rulepacksDir: resolve(root, 'rulepacks'),
          stdout: { write: (message) => stdoutLines.push(message) },
          stderr: { write: (message) => stderrLines.push(message) },
          now: () => new Date().toISOString(),
        },
      );
    } finally {
      restoreModelEnvironment(previous);
    }

    // No endpoint credentials means stage 4 remains honestly empty; no candidate is fabricated.
    expect(result.exitCode).toBe(1);
    expect(result.runDirectory).toBe(resolve(outDir, 'm1-11-real'));
    const runDirectory = result.runDirectory!;
    const run = JSON.parse(await readFile(join(runDirectory, 'run.json'), 'utf8')) as RunRecord;
    expect(run.schemaVersion).toBe(1);
    expect(run.runId).toBe('m1-11-real');
    expect(run.generator.id).toBe('@arxic/cli');
    expect(run.config.target.origin).toBe(origin);
    expect(run.stages.length).toBeGreaterThan(0);
    expect(run.stages).toContainEqual(
      expect.objectContaining({
        name: expect.stringContaining('attestation'),
        status: 'completed',
      }),
    );
    expect(Object.keys(run.toolVersions).length).toBeGreaterThan(0);

    const surface = JSON.parse(
      await readFile(join(runDirectory, 'artifacts', '05.json'), 'utf8'),
    ) as SurfaceArtifact;
    expect(surface.routes.map(({ path }) => path)).toEqual(
      expect.arrayContaining(['/', '/login', '/forgot-password']),
    );

    const diagnostics = await readDiagnostics(runDirectory);
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics.every((diagnostic) => validateDiagnostic(diagnostic).ok)).toBe(true);
    expect(diagnostics.every(({ code }) => /^ARXIC-[A-Z0-9-]+$/u.test(code))).toBe(true);
    const persistedConfig = JSON.parse(
      await readFile(join(runDirectory, 'config.json'), 'utf8'),
    ) as { target: { origin: string; environmentClass: string } };
    expect(persistedConfig.target.origin).toBe(origin);
    expect(persistedConfig.target.environmentClass).toBe('local-test');

    // The no-model path retains its honest partial outcome.
    expect(['observed', 'blocked']).toContain(run.outcome);
    expect(run.outcome).not.toBe('verified');
    // The orchestrator reserves `completed` for verified+promoted runs; a real but non-verified
    // run terminates honestly as `partial` (orchestrator finalize(), its own tests depend on this).
    expect(
      run.status,
      `outcome=${run.outcome}; tools=${Object.keys(run.toolVersions).join(',')}; routes=${surface.routes.map(({ path }) => path).join(',')}`,
    ).toBe('partial');
  }, 240_000);

  it('promotes the deterministic stage-10 verified auth bundle despite advisory discovery diagnostics', async () => {
    const outDir = await temporaryDirectory('arxic-release-cli-runs-');
    const previous = modelEnvironment();
    process.env.ARXIC_MODEL_BASE_URL = modelBaseUrl;
    process.env.ARXIC_MODEL_API_KEY = 'release-cli-stub-key';
    process.env.ARXIC_INPUT_PERSONA_EMAIL = 'm1-11@example.test';
    process.env.ARXIC_INPUT_PERSONA_PASSWORD = 'Hunter2!';
    try {
      const result = await runCli(
        ['run', '--config', configPath, '--out', outDir, '--run-id', 'release-cli-verified'],
        {
          cwd: root,
          rulepacksDir: resolve(root, 'rulepacks'),
          stdout: { write: () => undefined },
          stderr: { write: () => undefined },
          now: () => new Date().toISOString(),
        },
      );

      const runDirectory = resolve(outDir, 'release-cli-verified');
      const run = JSON.parse(await readFile(join(runDirectory, 'run.json'), 'utf8')) as RunRecord;
      expect(result.exitCode, JSON.stringify(run)).toBe(0);
      expect(run.outcome).toBe('verified');
      expect(run.status).toBe('completed');
      expect(run.stages).toContainEqual(
        expect.objectContaining({
          name: expect.stringContaining('verification'),
          status: 'completed',
        }),
      );
      expect(run.stages).toContainEqual(
        expect.objectContaining({
          name: expect.stringContaining('promotion'),
          status: 'completed',
        }),
      );
      expect(run.receipt).toMatchObject({ location: expect.any(String) });
      const verification = JSON.parse(
        await readFile(join(runDirectory, 'artifacts', '10.json'), 'utf8'),
      ) as { outcome: string; runs: Array<{ passed: boolean }> };
      expect(verification).toMatchObject({
        outcome: 'verified',
        runs: [{ passed: true }, { passed: true }],
      });
    } finally {
      restoreModelEnvironment(previous);
    }
  }, 300_000);

  it('classifies an unreachable target as blocked while preserving an honest run directory', async () => {
    const deadPort = await freePort();
    const deadOrigin = `http://127.0.0.1:${deadPort}`;
    const configDirectory = await temporaryDirectory('arxic-m1-11-unreachable-config-');
    const unreachableConfig = join(configDirectory, 'arxic.yaml');
    await writeConfig(unreachableConfig, deadOrigin);
    const outDir = await temporaryDirectory('arxic-m1-11-unreachable-runs-');
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    const result = await runCli(
      ['run', '--config', unreachableConfig, '--out', outDir, '--run-id', 'm1-11-unreachable'],
      {
        cwd: root,
        rulepacksDir: resolve(root, 'rulepacks'),
        stdout: { write: (message) => stdoutLines.push(message) },
        stderr: { write: (message) => stderrLines.push(message) },
        now: () => new Date().toISOString(),
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.runDirectory).toBe(resolve(outDir, 'm1-11-unreachable'));
    const runDirectory = result.runDirectory!;
    const run = JSON.parse(await readFile(join(runDirectory, 'run.json'), 'utf8')) as RunRecord;
    const diagnostics = await readDiagnostics(runDirectory);
    expect(run.outcome).toBe('blocked');
    expect(diagnostics).toContainEqual(expect.objectContaining({ severity: 'blocked' }));
    // The orchestrator marks a refused (fatal) attestation as `failed` + `blocked`; the CLI
    // reports that pipeline-level failure with exit 1 and preserves it in run.json.
    expect(
      run.status,
      `blocking diagnostics=${diagnostics
        .filter(({ severity }) => severity === 'blocked')
        .map(({ code }) => code)
        .join(',')}`,
    ).toBe('failed');
    expect(stderrLines.every((line) => !line.includes('\n    at '))).toBe(true);
  }, 120_000);
});

type RunRecord = {
  schemaVersion: number;
  runId: string;
  generator: { id: string };
  config: { target: { origin: string } };
  status: string;
  outcome: string;
  stages: Array<{ name: string; status: string }>;
  toolVersions: Record<string, string>;
  receipt?: { location: string };
};

type SurfaceArtifact = { routes: Array<{ path: string }> };

async function readDiagnostics(runDirectory: string): Promise<Diagnostic[]> {
  const bytes = await readFile(join(runDirectory, 'diagnostics.jsonl'), 'utf8');
  return bytes
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Diagnostic);
}

async function writeConfig(path: string, targetOrigin: string): Promise<void> {
  await writeFile(
    path,
    `version: 1
source:
  repository: ${JSON.stringify(sourceDirectory)}
  revision: ${JSON.stringify(commit)}
  languages: [typescript, javascript]
scope:
  domains: [authentication]
  frameworks: [nextjs, react]
  browsers: [chromium]
  personas: [anonymous, registered-user]
target:
  origin: ${JSON.stringify(targetOrigin)}
  environmentClass: local-test
  attestationPath: /.well-known/arxic-test-target.json
  allowedOrigins:
    - ${JSON.stringify(targetOrigin)}
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
  );
}

async function committedFixtureCopy(): Promise<string> {
  const directory = await temporaryDirectory('arxic-m1-11-source-');
  await cp(appDir, directory, {
    recursive: true,
    filter: (path) => !['node_modules', '.next', 'dist'].includes(basename(path)),
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

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate port');
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return address.port;
}

async function readiness(url: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Reference app exited with ${child.exitCode}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
  throw new Error('Reference app readiness timed out');
}

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())),
    new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function startModelEndpoint(): Promise<{ server: HttpServer; baseUrl: string }> {
  const server = createHttpServer(async (request, response) => {
    for await (const _chunk of request) void _chunk;
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        id: 'chatcmpl-release-cli',
        model: 'configured-adapter',
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                schemaVersion: 'arxic-stage4-inference-v1',
                candidates: [{ id: 'authentication.login', intent: 'Submit login credentials' }],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not start model endpoint');
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function stopServer(server: HttpServer | undefined): Promise<void> {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

function modelEnvironment(): Record<string, string | undefined> {
  return Object.fromEntries(
    [
      'ARXIC_MODEL_BASE_URL',
      'ARXIC_MODEL_API_KEY',
      'ARXIC_INPUT_PERSONA_EMAIL',
      'ARXIC_INPUT_PERSONA_PASSWORD',
    ].map((name) => [name, process.env[name]]),
  );
}

function restoreModelEnvironment(previous: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
