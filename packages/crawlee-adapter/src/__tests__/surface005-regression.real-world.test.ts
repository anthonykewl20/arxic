import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  allowedCrawlOrigins,
  ARXIC_SURFACE_NAVIGATION_FAILED,
  CrawleeSurfaceDiscoverer,
  pageInventoryProbe,
} from '..';
import { elementIdentityProbe } from '../../../playwright-agent-adapter/src/exploration-driver';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const appDir = resolve(root, 'test-fixtures/reference-auth-app');
// The tsx binary resolves from the only workspace package that depends on it
// (apps/worker); invoked with an absolute script path so cwd is irrelevant.
const tsxBin = resolve(root, 'apps/worker/node_modules/.bin/tsx');
const probeScript = resolve(root, 'packages/crawlee-adapter/src/__tests__/surface005-tsx-probe.ts');
let app: ChildProcess | undefined;
let origin = '';
let runtimeDirectory = '';

/**
 * DG-289 (#289, SURFACE-005) red-first regression. The baseline-red half of
 * the proof is recorded by the committed G-4 harness at baseline product
 * code (contract C-2): crawl-root ARXIC-SURFACE-005 with
 * `page.evaluate: ReferenceError: __name is not defined` and an empty crawl
 * inventory. This file proves the fixed state end-to-end in the SAME
 * transform lane: a tsx child (see surface005-tsx-probe.ts) imports the
 * adapter and driver SOURCE and runs a real-Chromium crawl.
 */
describe('SURFACE-005 serialization-safe callbacks (DG-289)', () => {
  beforeAll(async () => {
    await execute('pnpm', ['--filter', 'reference-auth-app', 'build'], {
      cwd: root,
      timeout: 180_000,
    });
    runtimeDirectory = await mkdtemp(join(tmpdir(), 'arxic-surface005-reg-'));
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
          ARXIC_ATTESTATION_NONCE: 'surface005-regression',
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
            personaId: 'surface-user',
            email: 'surface@example.test',
            password: 'Hunter2!',
          }),
        })
      ).status,
    ).toBe(201);
  }, 240_000);

  afterAll(async () => {
    await stop(app);
    if (runtimeDirectory) await rm(runtimeDirectory, { recursive: true, force: true });
  });

  it('the tsx lane keeps serialized callbacks free of __name and the crawl completes at root in real Chromium', async () => {
    // SP-1: if a page shape still triggers an injected-helper reference in
    // a serialized callback, this stays/fails red — the helper injection is
    // asserted positively (controlInjected) so a vacuous pass is impossible,
    // and the crawl itself is the behavioral assertion.
    const { stdout } = await execute(tsxBin, [probeScript, '--origin', origin], {
      cwd: root,
      timeout: 240_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const verdictLine = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{') && line.endsWith('}'))
      .pop();
    if (!verdictLine) throw new Error(`probe produced no verdict JSON; stdout: ${stdout}`);
    const verdict = JSON.parse(verdictLine) as {
      controlInjected: boolean;
      probeClean: boolean;
      routes: string[];
      crawlRootSubject: string;
      surface005AtRoot: Array<{ code: string; subject: string }>;
      identitySame: boolean;
      identityDifferent: boolean;
    };

    // Positive control FIRST: the tsx lane must still inject __name for
    // named inner helpers, otherwise probeClean below proves nothing.
    expect(verdict.controlInjected, 'tsx lane no longer injects __name — probe is vacuous').toBe(
      true,
    );
    expect(verdict.probeClean).toBe(true);
    expect(verdict.routes).toEqual(expect.arrayContaining(['/', '/login', '/forgot-password']));
    expect(verdict.crawlRootSubject).toBe(`${origin}/`);
    expect(verdict.surface005AtRoot).toEqual([]);
    expect(verdict.identitySame).toBe(true);
    expect(verdict.identityDifferent).toBe(false);
  }, 300_000);

  it('the vitest-lane adapter also crawls the reference app with zero crawl-root SURFACE-005', async () => {
    const adapter = new CrawleeSurfaceDiscoverer({ maxConcurrency: 2, maxRequestRetries: 1 });
    const result = await adapter.collect({ origin, maxUrls: 8, maxDepth: 1 });
    expect(result.routes.map((route) => route.path)).toEqual(
      expect.arrayContaining(['/', '/login', '/forgot-password']),
    );
    expect(
      result.diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === ARXIC_SURFACE_NAVIGATION_FAILED &&
          diagnostic.subject === `${origin}/`,
      ),
    ).toEqual([]);
  }, 120_000);

  // SP-2 (unit half): the crawl origin list is fail-closed by default and
  // admits exactly origin + declared entries when declared. The behavioral
  // gate proof (real Chromium asset admit/refuse) lives in
  // apps/cli/src/__tests__/allowed-origins.real-world.test.ts (AC-5).
  describe('allowedCrawlOrigins fail-closed defaults (SP-2)', () => {
    const base = { origin: 'http://127.0.0.1:1000' };

    it('unset declaration admits only the target origin', () => {
      expect(allowedCrawlOrigins(base)).toEqual(['http://127.0.0.1:1000']);
    });

    it('empty declaration admits only the target origin', () => {
      expect(allowedCrawlOrigins({ ...base, allowedOrigins: [] })).toEqual([
        'http://127.0.0.1:1000',
      ]);
    });

    it('declared origins are admitted alongside the target origin, deduplicated', () => {
      expect(
        allowedCrawlOrigins({
          ...base,
          allowedOrigins: [
            'http://127.0.0.1:1000',
            'http://127.0.0.1:2000',
            'http://127.0.0.1:2000',
          ],
        }),
      ).toEqual(['http://127.0.0.1:1000', 'http://127.0.0.1:2000']);
    });

    it('the serialized callback sources carry no __name token (vitest lane)', () => {
      // Under vitest no __name is injected at all; the authoritative lane
      // assertion is the tsx child above. This guards the source text itself
      // against reintroducing the token.
      expect(String(pageInventoryProbe)).not.toContain('__name');
      expect(String(elementIdentityProbe)).not.toContain('__name');
    });
  });
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate fixture port');
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
