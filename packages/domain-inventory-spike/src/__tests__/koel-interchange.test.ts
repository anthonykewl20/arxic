import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildInventory,
  serializeInventory,
  validateInterchange,
  validateInventory,
  type RouteInventoryInterchange,
} from '..';

/**
 * Real-world-data integration: the committed interchange artifact was produced
 * by the STAND-IN enumerator against the real public Laravel 13 application
 * koel/koel @ dfec91ff290509c622ff7cf392fb5e506841ee2b (MIT), cloned outside
 * the repository at /tmp/opencode/koel during the DG-02 measurement. Provenance
 * and the substitution rationale (campaign monorepo not locatable) are
 * documented in docs/spikes/dg-02-domain-inventory.md and
 * docs/evidence/DG-02/. The expected numbers below are independent literals
 * recorded at measurement time — not values derived from the code under test.
 */

const evidencePath = resolve(
  fileURLToPath(import.meta.url),
  '../../../../../docs/evidence/DG-02/koel-interchange.json',
);

describe('koel/koel real-repository interchange (stand-in PHP side)', () => {
  it('the committed artifact is a valid interchange from the stand-in pack', async () => {
    const raw: unknown = JSON.parse(await readFile(evidencePath, 'utf8'));
    const result = validateInterchange(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.standIn).toBe(true);
      expect(result.value.packId).toBe('arxic-langpack-php-standin@0.1.0');
      expect(result.value.provenance).toEqual({
        repository: 'https://github.com/koel/koel.git',
        commit: 'dfec91ff290509c622ff7cf392fb5e506841ee2b',
      });
    }
  });

  it('enumerates the measured route inventory (188 routes; independent recorded literal)', async () => {
    const interchange = JSON.parse(
      await readFile(evidencePath, 'utf8'),
    ) as RouteInventoryInterchange;
    expect(interchange.routes).toHaveLength(188);
    expect(interchange.gaps).toHaveLength(1);
    expect(interchange.gaps[0]).toMatchObject({
      kind: 'dynamic-registration',
      sourcePath: 'routes/subsonic.php',
    });
    const keys = interchange.routes.map((route) => `${route.methods.join('|')} ${route.uri}`);
    // Spot probes verified against the repository source at the pinned commit.
    expect(keys).toEqual(
      expect.arrayContaining([
        'POST /api/me',
        'GET /api/genres/{genre?}/songs',
        'PUT /api/me/password',
        'GET /api/albums/{album}/songs',
        'DELETE /api/albums/{album}/songs/{song}',
        'GET /play/{song}/{transcode?}',
        'POST /api/os/s3/song',
        'GET /api/radio/stations',
        'GET /auth/google/callback',
        'GET /download/songs',
      ]),
    );
    // Routes registered inside runtime-evaluated if-blocks are flagged, not
    // presented as unconditional (koel web.base.php download block).
    expect(
      interchange.routes.filter((route) => route.conditional).map((route) => route.uri),
    ).toEqual(
      expect.arrayContaining([
        '/download/songs',
        '/download/album/{album}',
        '/itunes/song/{album}',
      ]),
    );
  });

  it('fuses into a complete, deterministic, clustered denominator', async () => {
    const interchange = JSON.parse(
      await readFile(evidencePath, 'utf8'),
    ) as RouteInventoryInterchange;
    const inventory = buildInventory({ interchanges: [interchange] });
    expect(inventory.stats).toEqual(
      expect.objectContaining({
        totalRows: 189,
        byDisposition: {
          extracted: 188,
          unsupported: 0,
          unsafe: 0,
          'unextracted-with-reason': 1,
        },
      }),
    );
    expect(validateInventory(inventory).ok).toBe(true);
    const domains = inventory.clusters.map((cluster) => cluster.domain);
    expect(domains).toEqual(
      expect.arrayContaining([
        'album',
        'song',
        'playlist',
        'playlist-folder',
        'artist',
        'genre',
        'user',
        'podcast',
      ]),
    );
    // Deterministic rebuild from the committed artifact.
    const rebuilt = buildInventory({ interchanges: [interchange] });
    expect(serializeInventory(rebuilt)).toBe(serializeInventory(inventory));
  });

  // REGRESSION (review of PR #266, P1): prose claimed "19 clusters" while the
  // committed artifact holds 43 — the count drifted when the artifact was
  // regenerated after the nested-prefix-leak scanner fix. This pin makes any
  // future artifact/prose drift machine-caught. The literals below are
  // recorded from the 2026-08-16 measurement of the committed
  // docs/evidence/DG-02/koel-interchange.json, not derived from the code.
  it('pins the koel cluster count and the load-bearing distribution facts the report cites', async () => {
    const interchange = JSON.parse(
      await readFile(evidencePath, 'utf8'),
    ) as RouteInventoryInterchange;
    const inventory = buildInventory({ interchanges: [interchange] });
    expect(inventory.clusters).toHaveLength(43);
    const byDomain = new Map(inventory.clusters.map((cluster) => [cluster.domain, cluster]));
    // Top resource clusters (≥7 rows) that map onto koel's real bounded contexts.
    for (const [domain, size] of [
      ['artist', 19],
      ['album', 15],
      ['me', 15],
      ['playlist', 15],
      ['song', 15],
      ['podcast', 12],
      ['playlist-folder', 10],
      ['user', 8],
      ['radio', 7],
    ] as const) {
      expect(byDomain.get(domain)?.rowKeys, `cluster ${domain}`).toHaveLength(size);
    }
    // Utility/action singleton clusters — first-static-segment artifacts, not
    // bounded contexts; their existence is part of the honest record.
    for (const domain of [
      'ai',
      'ping',
      'remote',
      'overview',
      'one-time-token',
      'upload',
    ] as const) {
      expect(byDomain.get(domain)?.rowKeys, `cluster ${domain}`).toHaveLength(1);
    }
  });
});
