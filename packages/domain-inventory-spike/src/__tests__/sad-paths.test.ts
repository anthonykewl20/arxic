import { describe, expect, it } from 'vitest';
import type { RouteInventoryInterchange } from '..';
import {
  ARXIC_INVENTORY_COMPLETENESS,
  ARXIC_INVENTORY_INTERCHANGE_INVALID,
  ARXIC_INVENTORY_ROW_INVALID,
  buildInventory,
  validateInventory,
  validateInterchange,
} from '..';

/**
 * Sad-path-first (charter §4). Every hostile/malformed input must resolve to an
 * explicit accounting — a rejected interchange becomes a diagnosed gap, never a
 * crash and never a silent drop. Expected dispositions map to §2 truth states:
 * invalid input is `blocked`-shaped (fail-closed diagnostics), and the inventory
 * itself must remain complete regardless.
 */

const minimalInterchange = {
  schemaVersion: 1,
  packId: 'arxic-langpack-php-standin@0.1.0',
  language: 'php',
  framework: 'laravel',
  standIn: true,
  provenance: { repository: 'file:///tmp/repo', commit: 'a'.repeat(40) },
  routes: [
    {
      methods: ['GET'],
      uri: '/api/albums/{album}',
      sourcePath: 'routes/api.base.php',
      startLine: 1,
      endLine: 1,
    },
  ],
  gaps: [],
  files: [{ path: 'routes/api.base.php', sha256: 'b'.repeat(64) }],
};

describe('interchange validation fails closed', () => {
  it('rejects a wrong schemaVersion', () => {
    const result = validateInterchange({ ...minimalInterchange, schemaVersion: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.diagnostics.some((d) => d.code === ARXIC_INVENTORY_INTERCHANGE_INVALID)).toBe(
        true,
      );
  });

  it('rejects a route without a uri', () => {
    const broken = structuredClone(minimalInterchange);
    // @ts-expect-error deliberately malformed input
    broken.routes[0].uri = undefined;
    const result = validateInterchange(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('rejects a route with reversed line anchors (startLine > endLine)', () => {
    const broken = structuredClone(minimalInterchange);
    broken.routes[0].startLine = 9;
    broken.routes[0].endLine = 2;
    const result = validateInterchange(broken);
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid HTTP method token', () => {
    const broken = structuredClone(minimalInterchange);
    broken.routes[0].methods = ['FETCH'];
    const result = validateInterchange(broken);
    expect(result.ok).toBe(false);
  });

  it('accepts the route:list pipe-form method string ("GET|HEAD") as a compatibility anchor', () => {
    const anchored = structuredClone(minimalInterchange);
    // @ts-expect-error deliberately the upstream route:list shape
    delete anchored.routes[0].methods;
    // @ts-expect-error deliberately the upstream route:list shape
    anchored.routes[0].method = 'GET|HEAD';
    const result = validateInterchange(anchored);
    expect(result.ok).toBe(true);
  });

  it('rejects a gap with an unknown kind', () => {
    const broken = structuredClone(minimalInterchange);
    // @ts-expect-error deliberately malformed input
    broken.gaps.push({ kind: 'whatever', sourcePath: 'routes/x.php', reason: 'x' });
    const result = validateInterchange(broken);
    expect(result.ok).toBe(false);
  });

  it('rejects a non-standIn pack that does not declare a real packId version', () => {
    const broken = structuredClone(minimalInterchange);
    broken.standIn = false;
    broken.packId = 'php';
    const result = validateInterchange(broken);
    expect(result.ok).toBe(false);
  });
});

describe('inventory validation fails closed', () => {
  it('rejects a row whose disposition is not one of the four enum values', () => {
    const inventory = buildInventory({});
    inventory.rows.push({
      key: 'GET /broken',
      method: 'GET',
      path: '/broken',
      surfaceKind: 'page',
      origin: 'source',
      sourceRefs: [],
      runtimeRefs: [],
      runtimeUrls: [],
      observedForms: [],
      domain: 'broken',
      verbs: [],
      reason: '',
      count: 1,
      // @ts-expect-error deliberately corrupted disposition
      disposition: 'maybe',
    });
    const result = validateInventory(inventory);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.diagnostics.some((d) => d.code === ARXIC_INVENTORY_ROW_INVALID)).toBe(true);
  });

  it('rejects an unsupported row without a reason (no silent drops)', () => {
    const inventory = buildInventory({});
    inventory.rows.push({
      key: '* <unsupported-language:php>',
      surfaceKind: 'unknown',
      method: '*',
      path: '<unsupported-language:php>',
      origin: 'source',
      sourceRefs: [],
      runtimeRefs: [],
      runtimeUrls: [],
      observedForms: [],
      disposition: 'unsupported',
      domain: 'uncategorized',
      verbs: [],
      reason: '',
      count: 1,
    });
    inventory.stats.totalRows = inventory.rows.length;
    const result = validateInventory(inventory);
    expect(result.ok).toBe(false);
  });

  it('flags a completeness violation when stats disagree with rows', () => {
    const inventory = buildInventory({});
    inventory.rows.push({
      key: '* <unsupported-language:php>',
      surfaceKind: 'unknown',
      method: '*',
      path: '<unsupported-language:php>',
      origin: 'source',
      sourceRefs: [],
      runtimeRefs: [],
      runtimeUrls: [],
      observedForms: [],
      disposition: 'unsupported',
      reason: 'language-not-covered:php (3 files)',
      domain: 'uncategorized',
      verbs: [],
      count: 3,
    });
    // Deliberately stale stats: totalRows claims one fewer than rows.length.
    inventory.stats.totalRows = inventory.rows.length - 1;
    const result = validateInventory(inventory);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.diagnostics.some((d) => d.code === ARXIC_INVENTORY_COMPLETENESS)).toBe(true);
  });

  it('flags duplicate fusion keys (dedupe is structural, not advisory)', () => {
    const inventory = buildInventory({});
    const row = {
      key: 'GET /dup',
      surfaceKind: 'page' as const,
      method: 'GET',
      path: '/dup',
      origin: 'source' as const,
      sourceRefs: [],
      runtimeRefs: [],
      runtimeUrls: [],
      observedForms: [],
      disposition: 'extracted' as const,
      reason: '',
      domain: 'dup',
      verbs: [],
      count: 1,
    };
    inventory.rows.push({ ...row }, { ...row });
    inventory.stats.totalRows = inventory.rows.length;
    inventory.stats.byDisposition.extracted = 2;
    const result = validateInventory(inventory);
    expect(result.ok).toBe(false);
  });

  it('rejects an extracted row with zero source evidence refs (grounding is mandatory)', () => {
    const inventory = buildInventory({});
    inventory.rows.push({
      key: 'GET /fabricated',
      surfaceKind: 'page',
      method: 'GET',
      path: '/fabricated',
      origin: 'runtime',
      sourceRefs: [],
      runtimeRefs: [],
      runtimeUrls: ['http://127.0.0.1:1/fabricated'],
      observedForms: [],
      disposition: 'extracted',
      domain: 'fabricated',
      verbs: [],
      reason: '',
      count: 1,
    });
    inventory.stats.totalRows = inventory.rows.length;
    inventory.stats.byOrigin.runtime = 1;
    const result = validateInventory(inventory);
    expect(result.ok).toBe(false);
  });
});

describe('fusion sad paths keep the denominator honest', () => {
  it('an invalid interchange is accounted as a diagnosed gap row, never silently dropped', () => {
    const inventory = buildInventory({
      interchanges: [
        {
          ...structuredClone(minimalInterchange),
          schemaVersion: 99,
        } as unknown as RouteInventoryInterchange,
      ],
    });
    const invalidGap = inventory.rows.find((row) => row.reason?.startsWith('interchange-invalid'));
    expect(invalidGap).toBeDefined();
    expect(invalidGap?.disposition).toBe('unextracted-with-reason');
    const check = validateInventory(inventory);
    expect(check.ok).toBe(true);
  });

  it('a source scan that only produced diagnostics yields a gap row, not an empty silent inventory', () => {
    const inventory = buildInventory({
      sourceIndex: {
        revision: { repository: 'file:///nowhere', commit: null, dirty: false },
        manifest: [],
        events: [
          {
            diagnostic: {
              code: 'ARXIC-SOURCE-REPOSITORY-UNAVAILABLE',
              severity: 'blocked',
              subject: 'file:///nowhere',
              message: 'gone',
            },
          },
        ],
        toolVersions: {},
        generatedAt: '2026-08-16T00:00:00.000Z',
      },
    });
    expect(inventory.rows.length).toBeGreaterThan(0);
    expect(inventory.rows.every((row) => row.disposition !== undefined)).toBe(true);
    expect(validateInventory(inventory).ok).toBe(true);
  });

  it('empty inputs produce a valid, honestly-empty inventory (honest zero)', () => {
    const inventory = buildInventory({});
    expect(inventory.rows).toEqual([]);
    expect(inventory.stats.totalRows).toBe(0);
    expect(validateInventory(inventory).ok).toBe(true);
  });
});
