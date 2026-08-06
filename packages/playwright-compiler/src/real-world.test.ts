import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { EvidenceRef, Workflow } from '@arxic/contracts';
import { validateManifest } from '@arxic/contracts';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { PlaywrightCompiler } from './index';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const appDir = resolve(root, 'test-fixtures/reference-auth-app');
let app: ChildProcess | undefined;
let origin = '';
let runtimeDirectory = '';
let outputDirectory = '';

describe('real Playwright compiler proof', () => {
  beforeAll(async () => {
    await execute('pnpm', ['--filter', 'reference-auth-app', 'build'], {
      cwd: root,
      timeout: 180_000,
    });
    runtimeDirectory = await mkdtemp(join(root, '.arxic-compiler-runtime-'));
    outputDirectory = await mkdtemp(join(root, '.arxic-compiler-output-'));
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
    if (runtimeDirectory) await rm(runtimeDirectory, { recursive: true });
    if (outputDirectory) await rm(outputDirectory, { recursive: true });
  });

  test('stages a TypeScript suite discoverable by the real Playwright CLI', async () => {
    const workflow = loginWorkflow();
    const bundle = await new PlaywrightCompiler({ outputDirectory, origin }).compile(
      workflow,
      observations(origin),
    );
    expect(validateManifest(bundle.manifest).ok).toBe(true);
    expect(bundle.plan).toContain('login-page → home');
    await ensurePlaywrightModule(outputDirectory);
    const cliPath = resolvePlaywrightCli();
    const listing = await execute(process.execPath, [cliPath, 'test', '--list'], {
      cwd: outputDirectory,
      timeout: 120_000,
    });
    const output = `${listing.stdout}${listing.stderr}`;
    expect(output).toContain(workflow.id);
    const spec = await readFile(join(outputDirectory, 'tests/workflow.spec.ts'), 'utf8');
    for (const [index, transition] of workflow.transitions.entries()) {
      expect(spec).toContain(
        `artifacts/screenshots/step-${index + 1}-${transition.from}-${transition.to}.png`,
      );
    }
  }, 120_000);
});

function resolvePlaywrightCli(): string {
  try {
    return require.resolve('@playwright/test/cli.js');
  } catch {
    return require.resolve('@playwright/test/cli');
  }
}

async function ensurePlaywrightModule(directory: string): Promise<void> {
  const packageRoot = dirname(require.resolve('@playwright/test/package.json'));
  const scope = join(directory, 'node_modules', '@playwright');
  await mkdir(scope, { recursive: true });
  await symlink(packageRoot, join(scope, 'test'), 'dir');
}

function loginWorkflow(): Workflow {
  return {
    $schema: 'https://arxic.dev/schemas/workflow/v1.json',
    id: 'authentication.login',
    version: 1,
    title: 'Login',
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
        evidenceRefs: ['src:login-handler'],
      },
    ],
    negativeCases: [],
    verification: {
      requiredRuns: 2,
      screenshotCheckpoints: ['home'],
      forbidNetworkErrors: true,
      trace: 'retain',
    },
    evidenceRefs: ['src:login-handler'],
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
      extractor: 'real-world-compiler-test',
    },
    {
      kind: 'runtime',
      runId: 'run-real-world-compiler',
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
  if (!address || typeof address === 'string') throw new Error('Could not allocate compiler port');
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
