import { createHash } from 'node:crypto';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { EvidenceRef, Workflow } from '@arxic/contracts';
import { PlaywrightCompiler } from '@arxic/playwright-compiler';
import { PlaywrightVerifier } from '@arxic/verifier';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { assembleBundle, scanBundleForSensitiveData } from '..';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const appDirectory = resolve(root, 'test-fixtures/reference-auth-app');
let app: ChildProcess | undefined;
let origin = '';
let runtimeDirectory = '';
let stagedDirectory = '';
let artifactDirectory = '';
let bundleDirectory = '';

describe('real-world bundle assembly proof', () => {
  beforeAll(async () => {
    await execute('pnpm', ['--filter', 'reference-auth-app', 'build'], {
      cwd: root,
      timeout: 180_000,
    });
    runtimeDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-runtime-'));
    stagedDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-staged-'));
    artifactDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-artifacts-'));
    bundleDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-bundle-'));
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    app = spawn(
      process.execPath,
      [resolve(appDirectory, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)],
      {
        cwd: appDirectory,
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
      [runtimeDirectory, stagedDirectory, artifactDirectory, bundleDirectory]
        .filter(Boolean)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  test('compiles, verifies, assembles, redacts, and independently checks hashes', async () => {
    const persona = {
      email: 'bundle-proof@example.test',
      password: 'BundleProof9!',
      newPassword: 'BundleReplacement9!',
    };
    const bundle = await new PlaywrightCompiler({
      outputDirectory: stagedDirectory,
      origin,
    }).compile(loginWorkflow(), observations(origin));
    const seed = await fetch(`${origin}/__arxic/seed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personaId: 'bundle-proof', ...persona }),
    });
    expect(seed.status).toBe(201);
    const verification = await new PlaywrightVerifier({
      outputDirectory: stagedDirectory,
      origin,
      artifactsDir: artifactDirectory,
      persona,
    }).verify(bundle, {
      requiredRuns: 2,
      forbidNetworkErrors: true,
      screenshotCheckpoints: ['home'],
      trace: 'retain',
    });
    expect(verification.outcome, JSON.stringify(verification.diagnostics)).toBe('verified');

    const assembly = await assembleBundle({
      bundle,
      stagedDirectory,
      outputDirectory: bundleDirectory,
      verificationArtifacts: verification.artifacts,
      provenance: {
        repository: 'https://github.com/anthonykewl20/arxic',
        commit: bundle.workflow.scope.commit,
        appBuildDigest: bundle.manifest.appBuildDigest,
        toolVersions: { playwright: '1.62.1' },
      },
      now: () => '2026-08-06T12:00:00.000Z',
    });

    expect(await scanBundleForSensitiveData(assembly.directory)).toMatchObject({ passed: true });
    for (const line of assembly.checksumsSha256.trimEnd().split('\n')) {
      const [expected, path] = line.split('  ');
      const actual = createHash('sha256')
        .update(await readFile(join(assembly.directory, path!)))
        .digest('hex');
      expect(actual, path).toBe(expected);
    }
    const provenance = JSON.parse(
      await readFile(join(assembly.directory, 'provenance.json'), 'utf8'),
    );
    expect(provenance).toMatchObject({
      commit: bundle.workflow.scope.commit,
      appBuildDigest: bundle.manifest.appBuildDigest,
      generator: { id: '@arxic/bundle-promoter', version: '0.0.0' },
    });
    const notice = await readFile(join(assembly.directory, 'NOTICE'), 'utf8');
    expect(notice).toContain(`Workflow: ${bundle.workflow.id}`);
    expect(notice).toContain('License: MIT');
  }, 180_000);
});

function loginWorkflow(): Workflow {
  return {
    $schema: 'https://arxic.dev/schemas/workflow/v1.json',
    id: 'authentication.login.bundle',
    version: 1,
    title: 'Login bundle proof',
    domain: 'authentication',
    persona: 'registered-user',
    status: 'observed',
    confidence: 1,
    scope: {
      commit: '0123456789abcdef0123456789abcdef01234567',
      environment: 'local-test',
      browser: 'chromium',
    },
    preconditions: [{ fixture: 'user.exists' }],
    states: [{ id: 'login-page' }, { id: 'home' }],
    transitions: [
      {
        from: 'login-page',
        to: 'home',
        action: {
          intent: 'Submit login credentials',
          inputRefs: { email: 'persona.email', password: 'persona.password' },
        },
        assertions: [{ intent: 'url:/' }],
        evidenceRefs: ['src:login-handler', 'run:login'],
      },
    ],
    negativeCases: [],
    verification: {
      requiredRuns: 2,
      screenshotCheckpoints: ['home'],
      forbidNetworkErrors: true,
      trace: 'retain',
    },
    evidenceRefs: ['src:login-handler', 'run:login'],
  };
}

function observations(url: string): EvidenceRef[] {
  return [
    {
      kind: 'source',
      repo: 'https://github.com/anthonykewl20/arxic',
      commit: '0123456789abcdef0123456789abcdef01234567',
      path: 'test-fixtures/reference-auth-app/app/login/page.tsx',
      startLine: 1,
      endLine: 10,
      blobSha256: 'a'.repeat(64),
      extractor: 'real-world-bundle-test',
    },
    {
      kind: 'runtime',
      runId: 'run-real-world-bundle',
      appBuildDigest: 'b'.repeat(64),
      browser: 'chromium',
      browserVersion: '1.62.1',
      url: `${url}/login`,
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
  if (!address || typeof address === 'string') throw new Error('Could not allocate bundle port');
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
