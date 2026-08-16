import { describe, expect, it } from 'vitest';
import { buildInventory, matchRuntimePath, normalizePath, validateInventory } from '..';

const sourceIndex = (
  routes: Array<[string, string]>,
  manifest: Array<{ path: string; language: string; status: string; reason?: string }> = [],
) => ({
  revision: { repository: 'file:///tmp/x', commit: 'c'.repeat(40), dirty: false },
  manifest: manifest.map((file) => ({
    path: file.path,
    blobSha256: 'd'.repeat(64),
    sizeBytes: 10,
    language: file.language,
    category: /\.(?:md|mdx|txt)$/u.test(file.path)
      ? ('docs' as const)
      : /\.(?:json|yaml|yml|toml)$/u.test(file.path)
        ? ('config' as const)
        : /\.(?:css|scss|html)$/u.test(file.path)
          ? ('markup' as const)
          : ('code' as const),
    status: file.status as 'indexed' | 'skipped',
    ...(file.reason ? { reason: file.reason as 'unsupported-language' } : {}),
  })),
  events: routes.map(([routeId, path]) => ({
    ref: {
      kind: 'source' as const,
      repo: 'file:///tmp/x',
      commit: 'c'.repeat(40),
      path,
      startLine: 1,
      endLine: 2,
      blobSha256: 'd'.repeat(64),
      extractor: 'tree-sitter-typescript@1.0.0',
      ruleId: `route:${routeId}`,
    },
  })),
  toolVersions: {},
  generatedAt: '2026-08-16T00:00:00.000Z',
});

describe('path normalization (fusion key algebra)', () => {
  it('normalizes every upstream param syntax to one canonical :param form', () => {
    expect(normalizePath('/users/[id]').text).toBe('/users/:param');
    expect(normalizePath('/users/{id}').text).toBe('/users/:param');
    expect(normalizePath('/users/:id').text).toBe('/users/:param');
  });

  it('normalizes optional Laravel parameters', () => {
    expect(normalizePath('/genres/{genre?}/songs').text).toBe('/genres/:param?/songs');
  });

  it('strips trailing slashes (except root) and query/hash noise', () => {
    expect(normalizePath('/login/').text).toBe('/login');
    expect(normalizePath('/?x=1').text).toBe('/');
  });

  it('rejects paths that are not absolute with a leading slash', () => {
    expect(() => normalizePath('users/1')).toThrow();
  });
});

describe('runtime-to-source path matching', () => {
  const source = normalizePath('/api/albums/:param/songs');

  it('a concrete runtime value matches a parameterized source route', () => {
    expect(matchRuntimePath('/api/albums/42/songs', source)).toBe(true);
  });

  it('a different static segment does not match', () => {
    expect(matchRuntimePath('/api/artists/42/songs', source)).toBe(false);
  });

  it('a missing segment does not match', () => {
    expect(matchRuntimePath('/api/albums/42', source)).toBe(false);
  });

  it('an optional tail param matches both with and without a value', () => {
    const optional = normalizePath('/genres/:param?/songs');
    expect(matchRuntimePath('/genres/songs', optional)).toBe(true);
    expect(matchRuntimePath('/genres/rock/songs', optional)).toBe(true);
    expect(matchRuntimePath('/genres/rock/jazz/songs', optional)).toBe(false);
  });
});

describe('fusion and dedupe', () => {
  it('merges a source route and a matching interchange route into ONE row with merged evidence', () => {
    const inventory = buildInventory({
      sourceIndex: sourceIndex([
        ['GET /api/albums/[album]/songs', 'app/api/albums/[album]/songs/route.ts'],
      ]),
      interchanges: [
        {
          schemaVersion: 1,
          packId: 'arxic-langpack-php-standin@0.1.0',
          language: 'php',
          framework: 'laravel',
          standIn: true,
          provenance: { repository: 'file:///tmp/y', commit: 'e'.repeat(40) },
          routes: [
            {
              methods: ['GET'],
              uri: '/api/albums/{album}/songs',
              sourcePath: 'routes/api.base.php',
              startLine: 158,
              endLine: 158,
            },
          ],
          gaps: [],
          files: [{ path: 'routes/api.base.php', sha256: 'f'.repeat(64) }],
        },
      ],
    });
    expect(inventory.rows.filter((row) => row.path === '/api/albums/:param/songs')).toHaveLength(1);
    const merged = inventory.rows.find((row) => row.path === '/api/albums/:param/songs');
    expect(merged?.origin).toBe('source');
    expect(merged?.sourceRefs.length).toBe(2);
    expect(merged?.disposition).toBe('extracted');
    expect(validateInventory(inventory).ok).toBe(true);
  });

  it('a runtime page matching a parameterized source route fuses to origin both', () => {
    const inventory = buildInventory({
      sourceIndex: sourceIndex([['GET /users/[id]', 'app/users/[id]/page.tsx']]),
      surfaceMap: {
        schemaVersion: 1,
        truthState: 'observed',
        origin: 'http://127.0.0.1:3000',
        routes: [
          {
            truthState: 'observed',
            url: 'http://127.0.0.1:3000/users/42',
            path: '/users/42',
            depth: 1,
            title: 'User 42',
            forms: [],
            controls: [],
            links: [],
          },
        ],
        navigationEdges: [],
        diagnostics: [],
      },
    });
    const row = inventory.rows.find((row) => row.path === '/users/:param');
    expect(row).toBeDefined();
    expect(row?.origin).toBe('both');
    expect(row?.disposition).toBe('extracted');
    expect(row?.runtimeUrls).toEqual(['http://127.0.0.1:3000/users/42']);
  });

  it('a runtime page with no source match becomes unextracted-with-reason (no silent drop)', () => {
    const inventory = buildInventory({
      surfaceMap: {
        schemaVersion: 1,
        truthState: 'observed',
        origin: 'http://127.0.0.1:3000',
        routes: [
          {
            truthState: 'observed',
            url: 'http://127.0.0.1:3000/client-only-page',
            path: '/client-only-page',
            depth: 1,
            title: 'Client only',
            forms: [],
            controls: [],
            links: [],
          },
        ],
        navigationEdges: [],
        diagnostics: [],
      },
    });
    const row = inventory.rows.find((row) => row.path === '/client-only-page');
    expect(row?.origin).toBe('runtime');
    expect(row?.disposition).toBe('unextracted-with-reason');
    expect(row?.reason).toMatch(/no-source-match/);
  });

  it('a destructive runtime form with no source route is disposition unsafe', () => {
    const inventory = buildInventory({
      surfaceMap: {
        schemaVersion: 1,
        truthState: 'observed',
        origin: 'http://127.0.0.1:3000',
        routes: [
          {
            truthState: 'observed',
            url: 'http://127.0.0.1:3000/login',
            path: '/login',
            depth: 0,
            title: 'Login',
            forms: [
              {
                action: 'http://127.0.0.1:3000/login',
                method: 'POST',
                destructive: true,
                controls: [],
              },
            ],
            controls: [],
            links: [],
          },
        ],
        navigationEdges: [],
        diagnostics: [],
      },
    });
    const post = inventory.rows.find((row) => row.method === 'POST' && row.path === '/login');
    expect(post).toBeDefined();
    expect(post?.disposition).toBe('unsafe');
    expect(post?.reason).toMatch(/destructive-form-not-submitted/);
    const page = inventory.rows.find((row) => row.method === 'GET' && row.path === '/login');
    expect(page?.disposition).toBe('unextracted-with-reason');
  });

  it('a destructive runtime form matching a source route keeps extracted and records the form fact', () => {
    const inventory = buildInventory({
      sourceIndex: sourceIndex([['POST /login', 'src/server.ts']]),
      surfaceMap: {
        schemaVersion: 1,
        truthState: 'observed',
        origin: 'http://127.0.0.1:3000',
        routes: [
          {
            truthState: 'observed',
            url: 'http://127.0.0.1:3000/',
            path: '/',
            depth: 0,
            title: 'Home',
            forms: [
              {
                action: 'http://127.0.0.1:3000/login',
                method: 'POST',
                destructive: true,
                controls: [],
              },
            ],
            controls: [],
            links: [],
          },
        ],
        navigationEdges: [],
        diagnostics: [],
      },
    });
    const post = inventory.rows.find((row) => row.method === 'POST' && row.path === '/login');
    expect(post?.disposition).toBe('extracted');
    expect(post?.origin).toBe('both');
    expect(post?.observedForms).toEqual([
      { action: 'http://127.0.0.1:3000/login', method: 'POST', destructive: true },
    ]);
  });

  it('external-origin navigation edges are out-of-target and do NOT create rows', () => {
    const inventory = buildInventory({
      surfaceMap: {
        schemaVersion: 1,
        truthState: 'observed',
        origin: 'http://127.0.0.1:3000',
        routes: [],
        navigationEdges: [
          {
            from: 'http://127.0.0.1:3000/',
            to: 'https://evil.example.com/phish',
            depth: 1,
            status: 'blocked',
            reason: 'external-origin',
          },
        ],
        diagnostics: [],
      },
    });
    expect(inventory.rows).toEqual([]);
  });

  it('frontier-blocked same-origin links become unextracted rows naming the budget stop', () => {
    const inventory = buildInventory({
      surfaceMap: {
        schemaVersion: 1,
        truthState: 'observed',
        origin: 'http://127.0.0.1:3000',
        routes: [],
        navigationEdges: [
          {
            from: 'http://127.0.0.1:3000/',
            to: 'http://127.0.0.1:3000/deep/page',
            depth: 4,
            status: 'blocked',
            reason: 'max-depth',
          },
        ],
        diagnostics: [],
      },
    });
    const row = inventory.rows.find((row) => row.path === '/deep/page');
    expect(row?.disposition).toBe('unextracted-with-reason');
    expect(row?.reason).toMatch(/crawl-frontier-bound:max-depth/);
  });

  it('unsupported-language manifest files become ONE aggregated unsupported gap row per language (extension-derived, code category only)', () => {
    const inventory = buildInventory({
      sourceIndex: sourceIndex(
        [],
        [
          {
            path: 'app/a.php',
            language: 'unsupported',
            status: 'skipped',
            reason: 'unsupported-language',
          },
          {
            path: 'app/b.php',
            language: 'unsupported',
            status: 'skipped',
            reason: 'unsupported-language',
          },
          // A markdown doc is not a business-logic source; it must not inflate the gap.
          {
            path: 'README.md',
            language: 'unsupported',
            status: 'skipped',
            reason: 'unsupported-language',
          },
        ],
      ),
    });
    const gap = inventory.rows.find((row) => row.disposition === 'unsupported');
    expect(gap?.path).toBe('<unsupported-language:php>');
    expect(gap?.reason).toBe('language-not-covered:php (2 files)');
    expect(inventory.rows.filter((row) => row.disposition === 'unsupported')).toHaveLength(1);
  });

  it('parse-error manifest files become per-file unextracted rows', () => {
    const inventory = buildInventory({
      sourceIndex: sourceIndex(
        [],
        [
          {
            path: 'src/broken.ts',
            language: 'typescript',
            status: 'skipped',
            reason: 'parse-error',
          },
        ],
      ),
    });
    const gap = inventory.rows.find((row) => row.reason === 'source-parse-error');
    expect(gap?.disposition).toBe('unextracted-with-reason');
    expect(gap?.path).toBe('<parse-error:src/broken.ts>');
  });

  it('source scan failure diagnostics are preserved as gap rows', () => {
    const inventory = buildInventory({
      sourceIndex: {
        revision: { repository: 'file:///tmp/x', commit: 'c'.repeat(40), dirty: true },
        manifest: [],
        events: [
          {
            diagnostic: {
              code: 'ARXIC-SOURCE-DIRTY-TREE',
              severity: 'blocked',
              subject: '.',
              message: 'dirty',
            },
          },
        ],
        toolVersions: {},
        generatedAt: '2026-08-16T00:00:00.000Z',
      },
    });
    expect(
      inventory.rows.some((row) => row.reason === 'source-scan-diagnostic:ARXIC-SOURCE-DIRTY-TREE'),
    ).toBe(true);
  });
});
