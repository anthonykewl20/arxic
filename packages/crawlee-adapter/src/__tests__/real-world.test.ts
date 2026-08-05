import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ARXIC_SURFACE_FORM_SUBMIT_BLOCKED, CrawleeSurfaceDiscoverer } from '..';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const appDir = resolve(root, 'test-fixtures/reference-auth-app');
let app: ChildProcess | undefined;
let origin = '';
let database = '';
let runtimeDirectory = '';

describe('real Crawlee breadth discovery proof', () => {
  beforeAll(async () => {
    await execute('pnpm', ['--filter', 'reference-auth-app', 'build'], {
      cwd: root,
      timeout: 180_000,
    });
    runtimeDirectory = await mkdtemp(join(tmpdir(), 'arxic-crawlee-real-'));
    database = join(runtimeDirectory, 'auth.db');
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    app = spawn(
      process.execPath,
      [resolve(appDir, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)],
      {
        cwd: appDir,
        env: {
          ...process.env,
          ARXIC_DB_PATH: database,
          ARXIC_TARGET_ORIGIN: origin,
          ARXIC_ATTESTATION_NONCE: 'crawlee-real-world-proof',
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

  it('maps the real reference app in real PlaywrightCrawler/Chromium budgets without touching mutation state', async () => {
    const stateBefore = await databaseState();
    const adapter = new CrawleeSurfaceDiscoverer({ maxConcurrency: 2, maxRequestRetries: 1 });

    const result = await adapter.collect({
      origin,
      maxUrls: 8,
      maxDepth: 1,
      personas: ['surface-user'],
    });

    const paths = result.routes.map((route) => route.path);
    expect(paths).toEqual(expect.arrayContaining(['/', '/login', '/forgot-password']));
    expect(result.routes.length).toBeLessThanOrEqual(8);
    expect(result.routes.every((route) => route.depth <= 1)).toBe(true);
    expect(result.routes.find((route) => route.path === '/login')?.forms).toContainEqual(
      expect.objectContaining({ method: 'POST', destructive: true }),
    );
    expect(
      result.routes.find((route) => route.path === '/forgot-password')?.controls,
    ).toContainEqual(expect.objectContaining({ name: 'email', type: 'email', required: true }));
    expect(result.navigationEdges.length).toBeGreaterThanOrEqual(4);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_SURFACE_FORM_SUBMIT_BLOCKED, severity: 'blocked' }),
    );
    expect(result.routes.some((route) => route.evidence?.kind === 'runtime')).toBe(true);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.severity === ('verified' as never)),
    ).toBe(false);

    // Independent fixture truth: all mutable tables are byte-for-byte JSON-equivalent after breadth crawl.
    expect(await databaseState()).toEqual(stateBefore);
  }, 120_000);
});

async function databaseState(): Promise<string> {
  const script = [
    "const Database = require('better-sqlite3');",
    'const db = new Database(process.argv[1], { readonly: true });',
    "const tables = ['users', 'reset_tokens', 'sessions', 'mfa_challenges'];",
    "const state = Object.fromEntries(tables.map((table) => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()]));",
    'process.stdout.write(JSON.stringify(state));',
  ].join(' ');
  return (await execute(process.execPath, ['-e', script, database], { cwd: appDir })).stdout;
}

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
      // Keep polling the real process.
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
