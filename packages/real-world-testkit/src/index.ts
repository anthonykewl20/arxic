import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { EvidenceRef, Workflow } from '@arxic/contracts';

const execute = promisify(execFile);

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

export type Persona = {
  email: string;
  password: string;
  newPassword?: string;
};

export type LoginFacts = {
  fromState: string;
  toState: string;
  assertion: string;
  sourcePath: string;
  sourceRange: [number, number];
  loginRoute: string;
};

export type FixtureApp = {
  name: string;
  build: (root: string) => Promise<void>;
  start: (opts: {
    port: number;
    runtimeDirectory: string;
    origin: string;
    root: string;
  }) => ChildProcess;
  persona: Persona;
  login: LoginFacts;
};

export type RunningApp = {
  origin: string;
  child: ChildProcess;
  runtimeDirectory: string;
};

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate a free port');
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return address.port;
}

export async function bootFixtureApp(
  root: string,
  app: FixtureApp,
  prefix: string,
): Promise<RunningApp> {
  await app.build(root);
  const runtimeDirectory = await mkdtemp(join(tmpdir(), `${prefix}-`));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = app.start({ port, runtimeDirectory, origin, root });
  await readiness(origin, child);
  return { origin, child, runtimeDirectory };
}

export async function seedFixture(
  origin: string,
  personaId: string,
  persona: Persona,
): Promise<void> {
  const response = await fetch(`${origin}/__arxic/seed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ personaId, ...persona }),
  });
  if (!response.ok) throw new Error(`Seed returned ${response.status} for ${origin}`);
}

export async function stopApp(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())),
    new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

export function loginWorkflow(
  app: FixtureApp,
  options: { id: string; title: string; dualEvidence?: boolean },
): Workflow {
  const { fromState, toState, assertion } = app.login;
  const evidenceRefs = options.dualEvidence
    ? ['src:login-handler', 'run:login']
    : ['src:login-handler'];
  return {
    $schema: 'https://arxic.dev/schemas/workflow/v1.json',
    id: options.id,
    version: 1,
    title: options.title,
    domain: 'authentication',
    persona: 'registered-user',
    status: 'observed',
    confidence: 1,
    scope: { commit: COMMIT, environment: 'local-test', browser: 'chromium' },
    preconditions: [{ fixture: 'user.exists' }],
    states: [...new Set([fromState, toState])].map((stateId) => ({ id: stateId })),
    transitions: [
      {
        from: fromState,
        to: toState,
        action: {
          intent: 'Submit login credentials',
          inputRefs: { email: 'persona.email', password: 'persona.password' },
        },
        assertions: [{ intent: assertion }],
        evidenceRefs,
      },
    ],
    negativeCases: [],
    verification: {
      requiredRuns: 2,
      screenshotCheckpoints: [toState],
      forbidNetworkErrors: true,
      trace: 'retain',
    },
    evidenceRefs,
  };
}

export function loginObservations(
  app: FixtureApp,
  origin: string,
  extractor: string,
): EvidenceRef[] {
  const [startLine, endLine] = app.login.sourceRange;
  return [
    {
      kind: 'source',
      repo: 'https://github.com/anthonykewl20/arxic',
      commit: COMMIT,
      path: app.login.sourcePath,
      startLine,
      endLine,
      blobSha256: 'a'.repeat(64),
      extractor,
    },
    {
      kind: 'runtime',
      runId: `run-${extractor}`,
      appBuildDigest: 'b'.repeat(64),
      browser: 'chromium',
      browserVersion: '1.62.1',
      url: `${origin}${app.login.loginRoute}`,
      timestamp: new Date().toISOString(),
    },
  ];
}

export const referenceAuthApp: FixtureApp = {
  name: 'reference-auth-app',
  build: async (root) => {
    await execute('pnpm', ['--filter', 'reference-auth-app', 'build'], {
      cwd: root,
      timeout: 180_000,
    });
  },
  start: ({ port, runtimeDirectory, origin, root }) => {
    const appDir = resolve(root, 'test-fixtures/reference-auth-app');
    return spawn(
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
  },
  persona: {
    email: 'real-world-reference@example.test',
    password: 'RealWorldReference9!',
    newPassword: 'RealWorldReplacement9!',
  },
  login: {
    fromState: 'login-page',
    toState: 'home',
    assertion: 'url:/',
    sourcePath: 'test-fixtures/reference-auth-app/app/login/page.tsx',
    sourceRange: [1, 23],
    loginRoute: '/login',
  },
};

export const vulnerableAuthApp: FixtureApp = {
  name: 'vulnerable-auth-app',
  build: async () => {
    // Source-mode boot via tsx mirrors the fixture's own test globalSetup and
    // avoids the build-time EJS view-copy problem (views resolve from cwd).
  },
  start: ({ port, runtimeDirectory, origin, root }) => {
    const appDir = resolve(root, 'test-fixtures/vulnerable-auth-app');
    return spawn(
      process.execPath,
      [resolve(appDir, 'node_modules/tsx/dist/cli.mjs'), 'src/server.ts'],
      {
        cwd: appDir,
        env: {
          ...process.env,
          PORT: String(port),
          ARXIC_DB_PATH: join(runtimeDirectory, 'auth.db'),
          ARXIC_TARGET_ORIGIN: origin,
        },
        stdio: 'ignore',
        shell: false,
      },
    );
  },
  persona: {
    email: 'real-world-vulnerable@example.test',
    password: 'RealWorldVulnerable9!',
  },
  login: {
    fromState: 'home',
    toState: 'home',
    assertion: 'text:Logged in',
    sourcePath: 'test-fixtures/vulnerable-auth-app/src/server.ts',
    sourceRange: [34, 48],
    loginRoute: '/',
  },
};

export const FIXTURE_APPS: readonly FixtureApp[] = [referenceAuthApp, vulnerableAuthApp];

async function readiness(origin: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`App exited with status ${child.exitCode}`);
    try {
      if ((await fetch(origin)).ok) return;
    } catch {
      // Port not accepting connections yet; keep waiting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`App readiness timed out at ${origin}`);
}
