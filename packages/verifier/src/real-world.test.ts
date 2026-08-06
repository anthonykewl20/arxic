import { createHash } from 'node:crypto';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { EvidenceRef, StagedBundle, Workflow } from '@arxic/contracts';
import { PlaywrightCompiler } from '@arxic/playwright-compiler';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { PlaywrightVerifier } from './index';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const appDir = resolve(root, 'test-fixtures/reference-auth-app');
let app: ChildProcess | undefined;
let origin = '';
let runtimeDirectory = '';
let outputDirectory = '';
let artifactsDirectory = '';

describe('real Playwright verifier proof', () => {
  beforeAll(async () => {
    await execute('pnpm', ['--filter', 'reference-auth-app', 'build'], {
      cwd: root,
      timeout: 180_000,
    });
    runtimeDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-runtime-'));
    outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-output-'));
    artifactsDirectory = await mkdtemp(join(tmpdir(), 'arxic-verifier-artifacts-'));
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

  test('verifies two clean real Chromium passes and rejects locator drift', async () => {
    const persona = {
      email: 'verifier-proof@example.test',
      password: 'VerifierProof9!',
      newPassword: 'VerifierReplacement9!',
    };
    const bundle = await new PlaywrightCompiler({ outputDirectory, origin }).compile(
      loginWorkflow(),
      observations(origin),
    );
    const seed = await fetch(`${origin}/__arxic/seed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personaId: 'verifier-proof', ...persona }),
    });
    expect(seed.status).toBe(201);
    const verifier = new PlaywrightVerifier({
      outputDirectory,
      origin,
      artifactsDir: artifactsDirectory,
      persona,
    });
    const policy = {
      requiredRuns: 2,
      forbidNetworkErrors: true,
      screenshotCheckpoints: ['home'],
      trace: 'retain' as const,
    };

    const result = await verifier.verify(bundle, policy);

    expect(result.outcome, JSON.stringify(result.diagnostics)).toBe('verified');
    expect(result.runs).toEqual([{ passed: true }, { passed: true }]);
    expect(result.artifacts.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(['screenshot', 'trace']),
    );
    for (const artifact of result.artifacts) {
      const digest = createHash('sha256')
        .update(await readFile(artifact.path))
        .digest('hex');
      expect(digest).toBe(artifact.sha256);
    }

    const specArtifact = bundle.artifacts.find(({ kind }) => kind === 'playwright-spec');
    if (!specArtifact) throw new Error('Compiled real-world bundle has no spec');
    const specPath = join(outputDirectory, specArtifact.path);
    const driftedSpec = (await readFile(specPath, 'utf8')).replace(
      'getByLabel("Email")',
      "getByLabel('Nonexistent')",
    );
    expect(driftedSpec).toContain("getByLabel('Nonexistent')");
    await writeFile(specPath, driftedSpec);
    const driftedBundle: StagedBundle = {
      ...bundle,
      artifacts: bundle.artifacts.map((artifact) =>
        artifact.path === specArtifact.path
          ? {
              ...artifact,
              sha256: createHash('sha256').update(driftedSpec).digest('hex'),
            }
          : artifact,
      ),
    };

    const drifted = await verifier.verify(driftedBundle, policy);

    expect(drifted.outcome).not.toBe('verified');
    expect(drifted.outcome).toBe('contradicted');
  }, 180_000);
});

function loginWorkflow(): Workflow {
  return {
    $schema: 'https://arxic.dev/schemas/workflow/v1.json',
    id: 'authentication.login.verifier',
    version: 1,
    title: 'Login verifier proof',
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
      extractor: 'real-world-verifier-test',
    },
    {
      kind: 'runtime',
      runId: 'run-real-world-verifier',
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
  if (!address || typeof address === 'string') throw new Error('Could not allocate verifier port');
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
