import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CrawleeSurfaceDiscoverer as CrawleeSurfaceDiscovererType } from '@arxic/crawlee-adapter';
import type { SourceUaAdapter as SourceUaAdapterType } from '@arxic/source-ua-adapter';
import { buildInventory, serializeInventory, validateInventory } from '..';

/**
 * Real-world proof (charter §6): BOTH real fixture apps are (1) source-scanned
 * by the REAL Tree-sitter adapter (`@arxic/source-ua-adapter`, unmodified,
 * read-only consumption of its NormalizedSourceIndex output), (2) crawled by
 * the REAL Crawlee/Chromium adapter (`@arxic/crawlee-adapter`, unmodified,
 * read-only consumption of its SurfaceMap output), and (3) fused into ONE
 * deterministic denominator whose completeness invariant must hold.
 *
 * §10 environment rules: ephemeral ports via freePort(), per-run temp sqlite
 * via ARXIC_DB_PATH → mkdtemp, ARXIC_MAILPIT_SMTP/ARXIC_MAILPIT_API left
 * unset. No hardcoded port anywhere.
 */

const execute = promisify(execFile);
const root = fileURLToRoot();
const FIXED_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Arxic Test',
  GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
  GIT_COMMITTER_NAME: 'Arxic Test',
  GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
  GIT_AUTHOR_DATE: '2026-08-16T12:00:00Z',
  GIT_COMMITTER_DATE: '2026-08-16T12:00:00Z',
};

type FixtureName = 'reference-auth-app' | 'vulnerable-auth-app';

const APPS: Array<{ name: FixtureName; label: string }> = [
  { name: 'reference-auth-app', label: 'Next.js 15 App Router reference app' },
  { name: 'vulnerable-auth-app', label: 'Express vulnerable app' },
];

function fileURLToRoot(): string {
  return resolve(import.meta.dirname, '../../../..');
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execute('git', args, { cwd, env: FIXED_ENV, encoding: 'utf8' });
  return stdout.trim();
}

/** Mirror of the source-ua-adapter's own real-world test-repo helper. */
async function makeSourceRepository(fixture: FixtureName): Promise<{
  request: { revision: { repository: string; commit: string; dirty: boolean } };
}> {
  const directory = await mkdtemp(join(tmpdir(), 'dg02-source-'));
  const source = join(root, 'test-fixtures', fixture);
  await cp(source, directory, {
    recursive: true,
    filter: (path) => !['node_modules', '.next', 'dist'].includes(basename(path)),
  });
  await writeFile(
    join(directory, '.gitignore'),
    'node_modules/\n.next/\ndist/\nauth.db*\ntsconfig.tsbuildinfo\n',
  );
  await git(directory, 'init', '--initial-branch=main');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '-m', 'deterministic fixture');
  const commit = await git(directory, 'rev-parse', 'HEAD');
  return {
    request: { revision: { repository: pathToFileURL(directory).href, commit, dirty: false } },
  };
}

describe.each(APPS)('domain inventory of the real $label', ({ name }) => {
  let app: ChildProcess | undefined;
  let origin = '';
  let runtimeDirectory = '';
  let inventory: ReturnType<typeof buildInventory>;
  let sourceInputs: Parameters<typeof buildInventory>[0] | undefined;

  beforeAll(async () => {
    if (name === 'reference-auth-app') {
      await execute('pnpm', ['--filter', 'reference-auth-app', 'build'], {
        cwd: root,
        timeout: 240_000,
      });
    }
    runtimeDirectory = await mkdtemp(join(tmpdir(), `dg02-${name}-`));
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    const appDir = resolve(root, 'test-fixtures', name);
    app =
      name === 'reference-auth-app'
        ? spawn(
            process.execPath,
            [resolve(appDir, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)],
            {
              cwd: appDir,
              env: {
                ...process.env,
                ARXIC_DB_PATH: join(runtimeDirectory, 'auth.db'),
                ARXIC_TARGET_ORIGIN: origin,
                ARXIC_ATTESTATION_NONCE: 'dg02-domain-inventory',
              },
              stdio: 'ignore',
              shell: false,
            },
          )
        : spawn(
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
    await readiness(origin, app);

    const { SourceUaAdapter } = (await import('@arxic/source-ua-adapter')) as {
      SourceUaAdapter: new () => SourceUaAdapterType;
    };
    const { CrawleeSurfaceDiscoverer } = (await import('@arxic/crawlee-adapter')) as {
      CrawleeSurfaceDiscoverer: new (options: {
        maxConcurrency: number;
        maxRequestRetries: number;
      }) => CrawleeSurfaceDiscovererType;
    };

    const repo = await makeSourceRepository(name);
    const sourceIndex = await new SourceUaAdapter().collect(repo.request);
    const surfaceMap = await new CrawleeSurfaceDiscoverer({
      maxConcurrency: 2,
      maxRequestRetries: 1,
    }).collect({ origin, maxUrls: 12, maxDepth: 2 });

    sourceInputs = { sourceIndex, surfaceMap };
    inventory = buildInventory(sourceInputs);
  }, 300_000);

  afterAll(async () => {
    await stop(app);
    if (runtimeDirectory) await rm(runtimeDirectory, { recursive: true, force: true });
  });

  it('carries exactly one disposition per row and passes the completeness invariant', () => {
    const sum = Object.values(inventory.stats.byDisposition).reduce((a, b) => a + b, 0);
    expect(inventory.rows.length).toBe(sum);
    expect(inventory.stats.totalRows).toBe(inventory.rows.length);
    expect(validateInventory(inventory).ok).toBe(true);
    expect(inventory.rows.length).toBeGreaterThan(0);
  });

  it('grounds every extracted row in ≥1 line-anchored source EvidenceRef', () => {
    for (const row of inventory.rows.filter((candidate) => candidate.disposition === 'extracted')) {
      expect(row.sourceRefs.length).toBeGreaterThan(0);
      for (const ref of row.sourceRefs) {
        expect(ref.kind).toBe('source');
        expect(ref.startLine).toBeGreaterThanOrEqual(1);
        expect(ref.startLine).toBeLessThanOrEqual(ref.endLine);
      }
    }
  });

  it('is byte-stable across a rebuild from identical inputs', () => {
    // Same collected inputs, rebuilt: canonical serialization must be
    // byte-identical (generatedAt and volatile runtime fields are stripped).
    const first = serializeInventory(inventory);
    const second = serializeInventory(buildInventory(sourceInputs!));
    expect(second).toBe(first);
  });

  it('clusters every row exactly once into deterministic domains', () => {
    const clustered = inventory.clusters.reduce((sum, cluster) => sum + cluster.rowKeys.length, 0);
    expect(clustered).toBe(inventory.rows.length);
    expect(inventory.clusters.map((cluster) => cluster.domain)).toEqual(
      [...inventory.clusters.map((cluster) => cluster.domain)].sort(),
    );
  });

  it('fuses source and runtime observations of the same surface into one row', () => {
    const fused = inventory.rows.filter((row) => row.origin === 'both');
    expect(fused.length).toBeGreaterThan(0);
  });

  if (name === 'reference-auth-app') {
    it('inventories the real Next.js app: GET /login fused, destructive POST form explicit', () => {
      const loginPage = inventory.rows.find((row) => row.method === 'GET' && row.path === '/login');
      expect(loginPage?.disposition).toBe('extracted');
      expect(loginPage?.origin).toBe('both');
      expect(loginPage?.sourceRefs.some((ref) => ref.ruleId === 'route:GET /login')).toBe(true);
      // Next.js server-action forms are NOT extracted by the current
      // source-ua-adapter (page conventions only — a documented DG-01 gap), so
      // the destructive POST surface must surface as an explicit unsafe row
      // rather than disappearing.
      const loginPost = inventory.rows.find(
        (row) => row.method === 'POST' && row.path === '/login',
      );
      expect(loginPost?.disposition).toBe('unsafe');
      expect(loginPost?.reason).toBe('destructive-form-not-submitted');
    });
  }

  if (name === 'vulnerable-auth-app') {
    it('inventories the real Express app: POST /login extracted from source and observed at runtime', () => {
      const loginPost = inventory.rows.find(
        (row) => row.method === 'POST' && row.path === '/login',
      );
      expect(loginPost?.disposition).toBe('extracted');
      expect(loginPost?.origin).toBe('both');
      expect(loginPost?.sourceRefs.some((ref) => ref.ruleId === 'route:POST /login')).toBe(true);
      expect(loginPost?.observedForms.length).toBeGreaterThan(0);
      const home = inventory.rows.find((row) => row.method === 'GET' && row.path === '/');
      expect(home?.disposition).toBe('extracted');
    });
  }
});

async function freePort(): Promise<number> {
  const { createServer } = await import('node:net');
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

async function readiness(url: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`App exited with status ${child.exitCode}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not accepting connections yet; keep polling the real process.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`App readiness timed out at ${url}`);
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
