import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ARXIC_INVENTORY_URI_COLLISION,
  buildInventory,
  normalizePath,
  serializeInventory,
  validateInventory,
  type RouteInventoryInterchange,
} from '..';

/**
 * The BookStack fusion proof (DG-06): the committed REAL DG-05 interchange
 * artifact for BookStackApp/BookStack @ c813c1b3628c0b6bd757c12cadaa56f50724117d
 * carries 9 (method, uri) registrations that collide across files because the
 * per-file pack scan cannot apply the provider include's `api` prefix
 * (docs/_slice-notes/DG-05-language-pack-impl.md §6 deferral, owned by DG-06).
 *
 * The binding requirement (#250): the 9 collisions must RESOLVE under
 * provider-include prefix resolution, or remain VISIBLE STRUCTURED GAPS —
 * never silently merged rows. Both halves are proven here on real data.
 */

const evidencePath = resolve(
  fileURLToPath(import.meta.url),
  '../../../../../docs/evidence/DG-05/bookstack-arxic-langpack-php-interchange.json',
);

/** The real provider's two include statements @ c813c1b, padded to the REAL anchor lines 49/72. */
const filler = (count: number, start: number) =>
  Array.from({ length: count }, (_, index) => `// filler line ${start + index}`).join('\n');
const BOOKSTACK_PROVIDER = `<?php
${filler(41, 2)}
    protected function mapWebRoutes(): void
    {
        Route::group([
            'middleware' => 'web',
            'namespace'  => $this->namespace,
        ], function (Router $router) {
            require base_path('routes/web.php');
        });
    }

${filler(12, 53)}
    protected function mapApiRoutes(): void
    {
        Route::group([
            'middleware' => 'api',
            'namespace'  => $this->namespace . '\\\\Api',
            'prefix'     => 'api',
        ], function ($router) {
            require base_path('routes/api.php');
        });
    }
}
`;

async function artifact(): Promise<RouteInventoryInterchange> {
  return JSON.parse(await readFile(evidencePath, 'utf8')) as RouteInventoryInterchange;
}

describe('BookStack real interchange — unresolved collisions stay visible', () => {
  it('without prefix resolution the cross-file key merges surface as structured gap diagnostics', async () => {
    const inventory = buildInventory({ interchanges: [await artifact()] });

    const collisions = (inventory.diagnostics ?? []).filter(
      (diagnostic) => diagnostic.code === ARXIC_INVENTORY_URI_COLLISION,
    );
    // 19, not the DG-05 note's "9": the note counted raw (method, uri) pairs;
    // the fusion key algebra also collapses distinct parameter names
    // (`/books/{id}` vs `/books/{bookSlug}` → `/books/:param`), which adds
    // 10 more cross-file merges. Both numbers describe the same defect class
    // (api rows unprefixed); the inventory reports the fusion-key truth.
    expect(collisions).toHaveLength(19);
    // Spot-verified colliding keys (independent literals from the artifact).
    expect(collisions.map((diagnostic) => diagnostic.subject)).toEqual(
      expect.arrayContaining([
        'GET /books',
        'POST /books',
        'DELETE /books/:param',
        'GET /books/:param/export/html',
      ]),
    );
    // Structured: names both colliding files, observed severity (never blocks).
    expect(collisions[0]).toMatchObject({
      severity: 'observed',
      message: expect.stringContaining('routes/api.php'),
    });
    // The completeness invariant still holds with collisions visible.
    expect(validateInventory(inventory).ok).toBe(true);
  });

  it('unresolved include gaps stay in the denominator with their estimate', async () => {
    const inventory = buildInventory({ interchanges: [await artifact()] });
    const includeGapRows = inventory.rows.filter((row) =>
      row.reason.startsWith('interchange-gap:unresolved-file'),
    );
    expect(includeGapRows).toHaveLength(2);
    expect(includeGapRows.every((row) => row.disposition === 'unextracted-with-reason')).toBe(true);
  });
});

describe('BookStack real interchange — prefix resolution dissolves the 9 collisions', () => {
  it('resolved inventory has ZERO collision diagnostics and conserves route mass', async () => {
    const { resolveProviderIncludes } = await import('..');
    const resolved = await resolveProviderIncludes({
      interchanges: [await artifact()],
      readUtf8: async (path) =>
        path === 'app/App/Providers/RouteServiceProvider.php' ? BOOKSTACK_PROVIDER : null,
    });
    expect(resolved.resolutions).toHaveLength(2);

    const inventory = buildInventory({ interchanges: resolved.interchanges });
    const collisions = (inventory.diagnostics ?? []).filter(
      (diagnostic) => diagnostic.code === ARXIC_INVENTORY_URI_COLLISION,
    );
    expect(collisions).toHaveLength(0);

    // Every interchange registration lands on its own surface: the extracted
    // row count equals the count of distinct (method × normalized prefixed
    // uri) identities in the resolved interchange — nothing merged away.
    const interchangeKeys = new Set<string>();
    for (const route of resolved.interchanges[0].routes) {
      for (const method of route.methods) {
        interchangeKeys.add(`${method} ${normalizePath(route.uri).text}`);
      }
    }
    const extracted = inventory.rows.filter((row) => row.disposition === 'extracted');
    expect(extracted.length).toBe(interchangeKeys.size);
    expect(validateInventory(inventory).ok).toBe(true);

    // The api surfaces are now first-class rows under the api domain.
    expect(
      inventory.rows.filter((row) => row.path.startsWith('/api/')).map((row) => row.key),
    ).toEqual(expect.arrayContaining(['GET /api/books', 'POST /api/books', 'GET /api/shelves']));

    // Byte-stable rebuild from identical inputs.
    const rebuilt = buildInventory({ interchanges: resolved.interchanges });
    expect(serializeInventory(rebuilt)).toBe(serializeInventory(inventory));
  });
});
