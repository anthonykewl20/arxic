import { createHash } from 'node:crypto';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { StagedBundle } from '@arxic/contracts';
import { validateManifest } from '@arxic/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runM0Vertical } from '..';
import { loginWorkflow } from './workflow-fixture';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const appDir = resolve(root, 'test-fixtures/reference-auth-app');
const temporaryDirectories: string[] = [];
let app: ChildProcess | undefined;
let origin = '';
let sourceDir = '';
let commit = '';

describe('real M0 login vertical', () => {
  beforeAll(async () => {
    await execute('pnpm', ['--filter', 'reference-auth-app', 'build'], {
      cwd: root,
      timeout: 180_000,
    });
    sourceDir = await committedFixtureCopy();
    const runtime = await mkdtemp(join(tmpdir(), 'arxic-m0-exit-runtime-'));
    temporaryDirectories.push(runtime);
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
          ARXIC_ATTESTATION_NONCE: 'reference-auth-app-fixture-v1',
          ARXIC_DB_PATH: join(runtime, 'auth.db'),
        },
        stdio: 'ignore',
        shell: false,
      },
    );
    await readiness(origin, app);
  }, 240_000);

  afterAll(async () => {
    await stop(app);
    await Promise.all(
      temporaryDirectories.map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it('verifies twice in Chromium, promotes evidence, and preserves the second LKG on failure', async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), 'arxic-m0-exit-artifacts-'));
    temporaryDirectories.push(artifactsDir);
    const input = {
      candidate: loginWorkflow(commit),
      target: { origin, appDir: sourceDir, commit, appBuildDigest: 'a'.repeat(64) },
      rulepacksDir: resolve(root, 'rulepacks'),
      artifactsDir,
      persona: { email: 'm0-exit@example.test', password: 'Hunter2!' },
      requiredRuns: 2,
    };
    const first = await runM0Vertical(input);
    expect(first.outcome, JSON.stringify(first.diagnostics)).toBe('verified');
    expect(first.runs).toEqual([{ passed: true }, { passed: true }]);
    expect(first.receipt).toBeDefined();
    expect(Object.values(first.stagedBundle?.evidenceIndex ?? {}).length).toBeGreaterThanOrEqual(3);
    expect(
      Object.values(first.stagedBundle?.evidenceIndex ?? {}).map((ref) =>
        ref.kind === 'source' ? ref.ruleId : undefined,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('nextjs-page-route'),
        expect.stringContaining('nextjs-server-action'),
        expect.stringContaining('nextjs-auth-guard'),
      ]),
    );
    expect(first.stagedBundle?.artifacts.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(['spec', 'screenshot', 'trace', 'notice', 'provenance']),
    );
    const promotedBytes = await readFile(first.receipt!.location);
    expect(createHash('sha256').update(promotedBytes).digest('hex')).toBe(
      first.receipt!.checksumSha256,
    );
    const promoted = JSON.parse(promotedBytes.toString('utf8')) as StagedBundle;
    expect(validateManifest(promoted.manifest)).toEqual(expect.objectContaining({ ok: true }));
    expect(promoted.manifest).toMatchObject({
      workflow: { id: 'authentication.login', status: 'verified' },
      commit,
      appBuildDigest: 'a'.repeat(64),
      environment: { class: 'local-test', browser: 'chromium' },
      generator: { id: '@arxic/m0-pipeline', version: '0.0.0' },
      verification: { requiredRuns: 2 },
    });
    for (const artifact of promoted.artifacts) {
      const bytes = await readFile(artifact.path);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
    }
    const second = await runM0Vertical(input);
    expect(second.outcome).toBe('verified');
    const secondBytes = await readFile(second.receipt!.location);
    expect(secondBytes.equals(promotedBytes)).toBe(false);
    await writeFile(join(sourceDir, 'uncommitted.ts'), 'export const dirty = true;\n');
    const failed = await runM0Vertical(input);
    expect(failed.outcome).toBe('blocked');
    expect(failed.receipt).toBeUndefined();
    expect(await readFile(second.receipt!.location)).toEqual(secondBytes);
    const secondBundle = JSON.parse(secondBytes.toString('utf8')) as StagedBundle;
    for (const artifact of secondBundle.artifacts) {
      const bytes = await readFile(artifact.path);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
    }
  }, 240_000);
});

async function committedFixtureCopy(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-m0-exit-source-'));
  temporaryDirectories.push(directory);
  await cp(appDir, directory, {
    recursive: true,
    filter: (path) => !['node_modules', '.next', 'dist'].includes(basename(path)),
  });
  await writeFile(join(directory, '.gitignore'), 'node_modules/\n.next/\ndist/\nauth.db*\n');
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Arxic Test',
    GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
    GIT_COMMITTER_NAME: 'Arxic Test',
    GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
  };
  await execute('git', ['init', '--initial-branch=main'], { cwd: directory, env });
  await execute('git', ['add', '.'], { cwd: directory, env });
  await execute('git', ['commit', '-m', 'reference fixture'], { cwd: directory, env });
  commit = (await execute('git', ['rev-parse', 'HEAD'], { cwd: directory, env })).stdout.trim();
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
