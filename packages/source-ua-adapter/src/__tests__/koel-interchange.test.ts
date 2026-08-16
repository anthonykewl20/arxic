import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// Real DG-02 validator over the committed real-app artifact.
import { validateInterchange } from '../../../domain-inventory-spike/src/interchange';

/**
 * Real-world-data integration: the committed interchange artifact was produced
 * by the PRODUCTION PHP language pack (arxic-langpack-php@1.0.0) against the
 * real public Laravel 13 application koel/koel @
 * dfec91ff290509c622ff7cf392fb5e506841ee2b (MIT), cloned outside the
 * repository during the DG-05 measurement
 * (packages/source-ua-adapter/scripts/measure-laravel-inventory.mts). The
 * expected numbers below are independent literals recorded at measurement
 * time — not values derived from the code under test.
 */

const evidencePath = resolve(
  fileURLToPath(import.meta.url),
  '../../../../../docs/evidence/DG-05/koel-arxic-langpack-php-interchange.json',
);

describe('koel/koel real-repository interchange (production PHP pack side)', () => {
  it('the committed artifact is a valid interchange from the production pack', async () => {
    const raw: unknown = JSON.parse(await readFile(evidencePath, 'utf8'));
    const result = validateInterchange(raw);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.standIn).toBe(false);
    expect(result.value.packId).toBe('arxic-langpack-php@1.0.0');
    expect(result.value.language).toBe('php');
    expect(result.value.framework).toBe('laravel');
    expect(result.value.provenance).toEqual({
      repository: 'file:///tmp/opencode/koel',
      commit: 'dfec91ff290509c622ff7cf392fb5e506841ee2b',
    });
  });

  it('enumerates the measured route inventory (239 routes; independent recorded literal)', async () => {
    const raw = JSON.parse(await readFile(evidencePath, 'utf8')) as {
      routes: Array<{
        methods: string[];
        uri: string;
        conditional?: boolean;
        middleware?: string[];
      }>;
      gaps: unknown[];
    };
    expect(raw.routes).toHaveLength(239);
    expect(raw.gaps).toHaveLength(2);

    const keys = raw.routes.map((route) => `${route.methods.join('|')} ${route.uri}`);
    // Spot probes verified against the repository source at the pinned commit
    // (docs/spikes/dg-01-language-pack-spi.md §5.2 records the same corpus):
    // POST /api/me (login, api.base.php:108) and DELETE /api/me (logout, :112)
    // are separate registrations; the subsonic loop resolves into merged
    // GET|POST rows; nested apiResource update pairs merge to PUT|PATCH
    // (the top-level songs resource excludes update/destroy, api.base.php:167).
    expect(keys).toEqual(
      expect.arrayContaining([
        'POST /api/me',
        'DELETE /api/me',
        'GET|POST /rest/ping{format?}',
        'PUT|PATCH /api/albums/{album}/songs/{song}',
      ]),
    );
    // Every route carries composed middleware (api/web groups thread through).
    expect(raw.routes.every((route) => Array.isArray(route.middleware))).toBe(true);
    // Conditional marking: koel registers 7 routes inside if-blocks
    // (YouTube/iTunes/demo-download gates in routes/{api,web}.base.php).
    expect(raw.routes.filter((route) => route.conditional === true)).toHaveLength(7);
  });
});
