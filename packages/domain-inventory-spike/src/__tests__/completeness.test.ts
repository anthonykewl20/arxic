import { describe, expect, it } from 'vitest';
import { buildInventory, serializeInventory, validateInventory } from '..';
import type { RouteInventoryInterchange } from '..';

const interchange = (
  routes: Array<{ methods: string[]; uri: string }>,
): RouteInventoryInterchange => ({
  schemaVersion: 1,
  packId: 'arxic-langpack-php-standin@0.1.0',
  language: 'php',
  framework: 'laravel',
  standIn: true,
  provenance: { repository: 'file:///tmp/y', commit: 'e'.repeat(40) },
  routes: routes.map((route, index) => ({
    methods: route.methods as RouteInventoryInterchange['routes'][number]['methods'],
    uri: route.uri,
    sourcePath: 'routes/api.base.php',
    startLine: index + 1,
    endLine: index + 1,
  })),
  gaps: [],
  files: [{ path: 'routes/api.base.php', sha256: 'f'.repeat(64) }],
});

const surfaceMap = (paths: string[]) => ({
  schemaVersion: 1,
  truthState: 'observed' as const,
  origin: 'http://127.0.0.1:3000',
  routes: paths.map((path, index) => ({
    truthState: 'observed' as const,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    evidence: undefined as any,
    url: `http://127.0.0.1:3000${path}`,
    path,
    depth: index,
    title: `Page ${index}`,
    forms: [],
    controls: [],
    links: [],
  })),
  navigationEdges: [],
  diagnostics: [],
});

describe('completeness invariant (the binding acceptance check)', () => {
  it('total rows equals the sum of dispositions across mixed inputs', () => {
    const inventory = buildInventory({
      interchanges: [interchange([{ methods: ['GET'], uri: '/api/albums/{album}' }])],
      surfaceMap: surfaceMap(['/api/albums/7', '/nowhere-in-source']),
    });
    const byDisposition = inventory.rows.reduce<Record<string, number>>((counts, row) => {
      counts[row.disposition] = (counts[row.disposition] ?? 0) + 1;
      return counts;
    }, {});
    const sum = Object.values(byDisposition).reduce((a, b) => a + b, 0);
    expect(inventory.rows.length).toBe(sum);
    expect(inventory.stats.totalRows).toBe(sum);
    expect(inventory.stats.byDisposition['extracted']).toBe(byDisposition['extracted'] ?? 0);
    expect(inventory.stats.byDisposition['unextracted-with-reason']).toBe(
      byDisposition['unextracted-with-reason'] ?? 0,
    );
    expect(validateInventory(inventory).ok).toBe(true);
  });

  it('holds for an exhaustive enumeration of single-input shapes', () => {
    const inputs = [
      {},
      { surfaceMap: surfaceMap(['/a']) },
      { interchanges: [interchange([{ methods: ['GET'], uri: '/x' }])] },
      {
        interchanges: [interchange([{ methods: ['GET'], uri: '/x' }])],
        surfaceMap: surfaceMap(['/x', '/y']),
      },
    ];
    for (const input of inputs) {
      const inventory = buildInventory(input);
      const sum = Object.values(inventory.stats.byDisposition).reduce((a, b) => a + b, 0);
      expect(inventory.rows.length).toBe(sum);
      expect(inventory.stats.totalRows).toBe(inventory.rows.length);
      expect(validateInventory(inventory).ok).toBe(true);
    }
  });
});

describe('determinism', () => {
  it('serialization is byte-stable across rebuilds from identical inputs (volatile fields stripped)', () => {
    const input = {
      interchanges: [interchange([{ methods: ['GET'], uri: '/api/albums/{album}' }])],
      surfaceMap: surfaceMap(['/api/albums/7']),
    };
    const first = serializeInventory(buildInventory(input));
    const second = serializeInventory(buildInventory(input));
    expect(first).toBe(second);
  });

  it('serialization contains no runtime timestamps or run ids (privacy + determinism)', () => {
    const map = surfaceMap(['/x']);
    map.routes[0] = {
      ...map.routes[0],
      evidence: {
        kind: 'runtime',
        runId: 'run-123',
        appBuildDigest: 'a'.repeat(64),
        browser: 'chromium',
        browserVersion: '999.0.0',
        url: 'http://127.0.0.1:3000/x',
        timestamp: '2026-08-16T00:00:00.000Z',
      },
    };
    const text = serializeInventory(buildInventory({ surfaceMap: map }));
    expect(text).not.toContain('run-123');
    expect(text).not.toContain('2026-08-16T00:00:00.000Z');
    expect(text).not.toContain('999.0.0');
  });

  it('row order is canonical (path, then method) regardless of input order', () => {
    const a = buildInventory({
      interchanges: [
        interchange([
          { methods: ['GET'], uri: '/b' },
          { methods: ['GET'], uri: '/a' },
        ]),
      ],
    });
    const b = buildInventory({
      interchanges: [
        interchange([
          { methods: ['GET'], uri: '/a' },
          { methods: ['GET'], uri: '/b' },
        ]),
      ],
    });
    expect(a.rows.map((row) => row.key)).toEqual(['GET /a', 'GET /b']);
    expect(a.rows.map((row) => row.key)).toEqual(b.rows.map((row) => row.key));
  });
});
