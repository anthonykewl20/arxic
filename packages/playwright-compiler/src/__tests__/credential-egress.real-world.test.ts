import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { EvidenceRef, Workflow } from '@arxic/contracts';
import { afterEach, expect, test } from 'vitest';
import { PlaywrightCompiler } from '../compiler';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

test('real Chromium aborts a foreign-origin navigation redirect before credential bytes leave the approved origin', async () => {
  const foreignRequests: string[] = [];
  const foreign = createServer((request, response) => {
    foreignRequests.push(`${request.method} ${request.url}`);
    response.end('foreign');
  });
  const foreignOrigin = await listen(foreign);
  const approved = createServer((_request, response) => {
    response.writeHead(302, { location: `${foreignOrigin}/capture` });
    response.end();
  });
  const approvedOrigin = await listen(approved);
  const directory = await mkdtemp(join(tmpdir(), 'arxic-egress-redirect-'));
  cleanups.push(() => rm(directory, { recursive: true }));

  await new PlaywrightCompiler({ outputDirectory: directory, origin: approvedOrigin }).compile(
    loginWorkflow(),
    observations(`${approvedOrigin}/login`),
  );
  await ensurePlaywrightModule(directory);

  let output = '';
  try {
    await execute(process.execPath, [resolvePlaywrightCli(), 'test'], {
      cwd: directory,
      env: {
        ...process.env,
        ARXIC_INPUT_PERSONA_EMAIL: 'egress-canary@example.test',
        ARXIC_INPUT_PERSONA_PASSWORD: 'EgressCanary9!',
      },
      timeout: 120_000,
    });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
  }

  expect(output).toContain('ARXIC-COMPILE-ORIGIN-DENIED');
  expect(foreignRequests).toEqual([]);
}, 120_000);

test('generated policy blocks service workers and installs context interception before navigation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-egress-source-'));
  cleanups.push(() => rm(directory, { recursive: true }));
  await new PlaywrightCompiler({
    outputDirectory: directory,
    origin: 'http://127.0.0.1:3000',
  }).compile(loginWorkflow(), observations('http://127.0.0.1:3000/login'));

  const fixture = await readFile(join(directory, 'fixtures/workflow.fixture.ts'), 'utf8');
  const config = await readFile(join(directory, 'playwright.config.ts'), 'utf8');
  expect(fixture.indexOf("context.route('**/*'")).toBeLessThan(
    fixture.indexOf('route.fetch({ maxRedirects: 0 })'),
  );
  expect(config).toContain("serviceWorkers: 'block'");
});

test('real Chromium blocks a page-context cross-origin fetch and service worker registration', async () => {
  const foreignRequests: string[] = [];
  const foreign = createServer((request, response) => {
    foreignRequests.push(`${request.method} ${request.url}`);
    response.end('foreign');
  });
  const foreignOrigin = await listen(foreign);
  const approved = createServer((request, response) => {
    if (request.url === '/sw.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end("self.addEventListener('fetch', () => {});");
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<main>approved</main>');
  });
  const approvedOrigin = await listen(approved);
  const directory = await mkdtemp(join(tmpdir(), 'arxic-egress-page-'));
  cleanups.push(() => rm(directory, { recursive: true }));

  await new PlaywrightCompiler({ outputDirectory: directory, origin: approvedOrigin }).compile(
    loginWorkflow(),
    observations(`${approvedOrigin}/login`),
  );
  await ensurePlaywrightModule(directory);
  await writeFile(
    join(directory, 'tests/workflow.spec.ts'),
    `import { test, expect, enforceNetworkContainment } from '../fixtures/workflow.fixture';
test('page egress', async ({ page, context }) => {
  await page.goto(${JSON.stringify(approvedOrigin)});
  await page.evaluate(() => navigator.serviceWorker.register('/sw.js').catch(() => undefined));
  await expect(page.evaluate(() => navigator.serviceWorker.getRegistrations().then((items) => items.length))).resolves.toBe(0);
  await expect(enforceNetworkContainment(context, () => page.evaluate(() => fetch(${JSON.stringify(`${foreignOrigin}/capture`)})))).rejects.toThrow('ARXIC-COMPILE-ORIGIN-DENIED');
});
`,
  );

  let output = '';
  try {
    await execute(process.execPath, [resolvePlaywrightCli(), 'test'], {
      cwd: directory,
      timeout: 120_000,
    });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
  }
  expect(output).toContain('ARXIC-COMPILE-ORIGIN-DENIED');
  expect(foreignRequests).toEqual([]);
}, 120_000);

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server did not bind TCP');
  return `http://127.0.0.1:${address.port}`;
}

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
    id: 'authentication.credential-egress',
    version: 1,
    title: 'Credential egress containment',
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
        assertions: [{ intent: 'text:Welcome' }],
        evidenceRefs: ['src:login'],
      },
    ],
    negativeCases: [],
    verification: {
      requiredRuns: 2,
      screenshotCheckpoints: ['home'],
      forbidNetworkErrors: true,
      trace: 'discard',
    },
    evidenceRefs: ['src:login'],
  };
}

function observations(runtimeUrl: string): EvidenceRef[] {
  return [
    {
      kind: 'source',
      repo: 'https://github.com/example/app',
      commit: '0123456789abcdef0123456789abcdef01234567',
      path: 'login.ts',
      startLine: 1,
      endLine: 2,
      blobSha256: 'a'.repeat(64),
      extractor: 'credential-egress-test',
    },
    {
      kind: 'runtime',
      runId: 'credential-egress-test',
      appBuildDigest: 'b'.repeat(64),
      browser: 'chromium',
      browserVersion: '1.62.1',
      url: runtimeUrl,
      timestamp: '2026-08-13T00:00:00.000Z',
    },
  ];
}
