import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { EvidenceRef } from '@arxic/contracts';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { AuthDomainPackAssembler, authCandidates } from './index';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const appDir = resolve(root, 'test-fixtures/reference-auth-app');
let app: ChildProcess | undefined;
let origin = '';
let runtimeDirectory = '';
let outputDirectory = '';
let artifactsDirectory = '';

describe('real authentication domain pack proof', () => {
  beforeAll(async () => {
    await execute('pnpm', ['--filter', 'reference-auth-app', 'build'], {
      cwd: root,
      timeout: 180_000,
    });
    runtimeDirectory = await mkdtemp(join(tmpdir(), 'arxic-auth-pack-runtime-'));
    outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-auth-pack-output-'));
    artifactsDirectory = await mkdtemp(join(tmpdir(), 'arxic-auth-pack-artifacts-'));
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    app = spawn(
      process.execPath,
      [resolve(appDir, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)],
      {
        cwd: appDir,
        env: {
          ...process.env,
          ARXIC_DB_PATH: join(runtimeDirectory, 'auth.db'),
          ARXIC_TARGET_ORIGIN: origin,
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
      [runtimeDirectory, outputDirectory, artifactsDirectory]
        .filter(Boolean)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  test('assembles independent real Chromium auth results and explicit fixture blockers', async () => {
    const persona = {
      email: 'auth-pack-proof@example.test',
      password: 'AuthPackProof9!',
      newPassword: 'AuthPackReplacement9!',
    };
    const seeded = await fetch(`${origin}/__arxic/seed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personaId: 'auth-pack-proof', ...persona }),
    });
    expect(seeded.status).toBe(201);
    const pack = await new AuthDomainPackAssembler({
      origin,
      outputDirectory,
      artifactsDir: artifactsDirectory,
      persona,
    }).assemble(authCandidates(), observations());

    expect(workflow(pack, 'authentication.login').outcome).toBe('verified');
    expect(workflow(pack, 'authentication.logout').outcome).toBe('verified');
    expect(workflow(pack, 'authentication.password-change').outcome).toBe('verified');
    expect(workflow(pack, 'authentication.reset-request')).toMatchObject({
      outcome: 'blocked',
      diagnostics: [{ code: 'ARXIC-AUTH-FIXTURE-UNAVAILABLE' }],
    });
    expect(workflow(pack, 'authentication.reset-complete')).toMatchObject({
      outcome: 'blocked',
      diagnostics: [{ code: 'ARXIC-AUTH-FIXTURE-UNAVAILABLE' }],
    });
    expect(workflow(pack, 'authentication.totp')).toMatchObject({
      outcome: 'blocked',
      diagnostics: [{ code: 'ARXIC-AUTH-FIXTURE-UNAVAILABLE' }],
    });
    expect(pack.coverageMatrix.denominator).toBe(6);
    expect(pack.manifest).toMatchObject({ verified: 3, blocked: 3, contradicted: 0 });
    expect(
      pack.coverageMatrix.rows.filter(({ outcome }) => outcome === 'blocked'),
    ).not.toHaveLength(0);
    expect(pack.workflows.every((result) => result.outcome === 'verified' || !result.bundle)).toBe(
      true,
    );

    const manifest = JSON.parse(
      await readFile(join(outputDirectory, 'domain-manifest.json'), 'utf8'),
    ) as { domain?: string; workflowCount?: number };
    const matrix = JSON.parse(
      await readFile(join(outputDirectory, 'coverage-matrix.json'), 'utf8'),
    ) as { denominator?: number; rows?: unknown[] };
    expect(manifest).toMatchObject({ domain: 'authentication', workflowCount: 6 });
    expect(matrix).toMatchObject({ denominator: 6 });
    expect(matrix.rows).toHaveLength(6);
  }, 300_000);
});

function workflow(pack: Awaited<ReturnType<AuthDomainPackAssembler['assemble']>>, id: string) {
  const result = pack.workflows.find((item) => item.id === id);
  if (!result) throw new Error(`Missing workflow ${id}`);
  return result;
}

function observations(): EvidenceRef[] {
  return [
    {
      kind: 'source',
      repo: 'https://github.com/anthonykewl20/arxic',
      commit: '0123456789abcdef0123456789abcdef01234567',
      path: 'test-fixtures/reference-auth-app/app/login/page.tsx',
      startLine: 1,
      endLine: 23,
      blobSha256: 'a'.repeat(64),
      extractor: 'real-world-auth-domain-pack-test',
    },
    {
      kind: 'runtime',
      runId: 'run-real-world-auth-domain-pack',
      appBuildDigest: 'b'.repeat(64),
      browser: 'chromium',
      browserVersion: '1.62.1',
      url: `${origin}/login`,
      timestamp: new Date().toISOString(),
    },
  ];
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate auth pack port');
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
      continue;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
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
