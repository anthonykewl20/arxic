import { describe, expect, it } from 'vitest';
import { clusterInventory, normalizePath } from '..';
import type { InventoryRow } from '..';

const row = (overrides: Partial<InventoryRow>): InventoryRow => ({
  key: 'GET /',
  surfaceKind: 'page',
  method: 'GET',
  path: '/',
  origin: 'source',
  sourceRefs: [],
  runtimeRefs: [],
  runtimeUrls: [],
  observedForms: [],
  disposition: 'extracted',
  reason: '',
  domain: 'uncategorized',
  verbs: [],
  count: 1,
  ...overrides,
});

describe('deterministic domain clustering (resource/noun + verb heuristics)', () => {
  it('clusters api routes by their first static resource segment, singularized', () => {
    const rows = [
      row({ key: 'GET /api/albums', path: '/api/albums', method: 'GET' }),
      row({ key: 'POST /api/albums', path: '/api/albums', method: 'POST' }),
      row({ key: 'GET /api/albums/:param/songs', path: '/api/albums/:param/songs', method: 'GET' }),
      row({ key: 'GET /api/playlists', path: '/api/playlists', method: 'GET' }),
    ];
    const clusters = clusterInventory(rows);
    const byDomain = new Map(clusters.map((cluster) => [cluster.domain, cluster]));
    expect(byDomain.get('album')?.rowKeys).toEqual([
      'GET /api/albums',
      'GET /api/albums/:param/songs',
      'POST /api/albums',
    ]);
    expect(byDomain.get('playlist')?.rowKeys).toEqual(['GET /api/playlists']);
  });

  it('derives CRUD verbs from method + parameterization', () => {
    const rows = [
      row({ key: 'GET /api/albums', path: '/api/albums', method: 'GET' }),
      row({ key: 'GET /api/albums/:param', path: '/api/albums/:param', method: 'GET' }),
      row({ key: 'POST /api/albums', path: '/api/albums', method: 'POST' }),
      row({ key: 'PUT /api/albums/:param', path: '/api/albums/:param', method: 'PUT' }),
      row({ key: 'PATCH /api/albums/:param', path: '/api/albums/:param', method: 'PATCH' }),
      row({ key: 'DELETE /api/albums/:param', path: '/api/albums/:param', method: 'DELETE' }),
    ];
    const clusters = clusterInventory(rows);
    expect(clusters[0]?.verbs).toEqual(['create', 'delete', 'read-list', 'read-one', 'update']);
  });

  it('derives action verbs from a documented path-segment lexicon', () => {
    const rows = [
      row({ key: 'POST /login', path: '/login', method: 'POST' }),
      row({ key: 'POST /logout', path: '/logout', method: 'POST' }),
      row({ key: 'GET /api/songs/search', path: '/api/songs/search', method: 'GET' }),
    ];
    const clusters = clusterInventory(rows);
    const all = clusters.flatMap((cluster) => cluster.verbs);
    expect(all).toContain('login');
    expect(all).toContain('logout');
    expect(all).toContain('search');
  });

  it('root pages and gap rows cluster to documented fallbacks, never vanish', () => {
    const rows = [
      row({ key: 'GET /', path: '/', method: 'GET' }),
      row({
        key: '* <unsupported-language:php>',
        path: '<unsupported-language:php>',
        method: '*',
        surfaceKind: 'unknown',
        disposition: 'unsupported',
        reason: 'language-not-covered:php (2 files)',
      }),
    ];
    const clusters = clusterInventory(rows);
    const domains = clusters.map((cluster) => cluster.domain);
    expect(domains).toContain('root');
    expect(domains).toContain('uncategorized');
    // Every row is clustered exactly once.
    expect(clusters.reduce((sum, cluster) => sum + cluster.rowKeys.length, 0)).toBe(rows.length);
  });

  it('clusters carry per-disposition accounting', () => {
    const rows = [
      row({ key: 'GET /x', path: '/x', domain: 'x', disposition: 'extracted' }),
      row({
        key: 'POST /x',
        path: '/x',
        method: 'POST',
        domain: 'x',
        disposition: 'unsafe',
        reason: 'destructive-form-not-submitted',
      }),
    ];
    const clusters = clusterInventory(rows);
    expect(clusters[0]?.dispositions).toEqual({
      extracted: 1,
      unsupported: 0,
      unsafe: 1,
      'unextracted-with-reason': 0,
    });
  });

  it('is deterministic: identical rows produce identical clusters in identical order', () => {
    const rows = [
      row({ key: 'GET /b', path: '/b' }),
      row({ key: 'GET /a', path: '/a' }),
      row({ key: 'POST /a', path: '/a', method: 'POST' }),
    ];
    expect(clusterInventory(rows)).toEqual(clusterInventory(rows));
  });

  it('hyphenated action segments do not leak into resource nouns for api subpaths', () => {
    const rows = [row({ key: 'POST /api/me/password', path: '/api/me/password', method: 'POST' })];
    const clusters = clusterInventory(rows);
    expect(clusters[0]?.domain).toBe('me');
  });
});

describe('normalizePath segment algebra', () => {
  it('percent-encodes nothing and never mangles static segments', () => {
    expect(normalizePath('/.well-known/arxic-test-target.json').text).toBe(
      '/.well-known/arxic-test-target.json',
    );
  });
});
