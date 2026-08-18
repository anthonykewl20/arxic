import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveProviderIncludes,
  validateInterchange,
  type InterchangeGap,
  type RouteInventoryInterchange,
} from '..';

/**
 * Provider-include PREFIX RESOLUTION (two-pass providers→routes composition) —
 * DG-05's highest-value deferred gap (#249 slice note §6), owned here per the
 * DG-06 contract: the per-file pack scan cannot apply the INCLUDING group's
 * prefix to an included route file, so BookStack's `routes/api.php` rows are
 * emitted unprefixed and collide with `routes/web.php` rows (9 (method, uri)
 * collisions at BookStackApp/BookStack @ c813c1b3628c0b6bd757c12cadaa56f50724117d).
 *
 * The fusion layer performs the second pass the per-file scan cannot: it reads
 * the PROVIDER file (the gap's sourcePath), extracts the enclosing
 * `Route::group` prefix context around the anchored include, and rewrites the
 * included file's route URIs. Everything the resolver cannot resolve stays a
 * visible structured gap — never a silent drop.
 *
 * Sad paths FIRST (charter §4): no file access, dynamic include paths,
 * unprovable group context, anchors outside the provider.
 */

const COMMIT = 'a'.repeat(40);

/** BookStack RouteServiceProvider::mapApiRoutes (real shape, @ c813c1b). */
const BOOKSTACK_API_PROVIDER = `<?php

namespace BookStack\\App\\Providers;

use Illuminate\\Routing\\Router;
use Illuminate\\Support\\Facades\\Route;

class RouteServiceProvider extends ServiceProvider
{
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

/** BookStack mapWebRoutes (real shape): group WITHOUT a prefix. */
const BOOKSTACK_WEB_PROVIDER = `<?php

class RouteServiceProvider extends ServiceProvider
{
    protected function mapWebRoutes(): void
    {
        Route::group([
            'middleware' => 'web',
            'namespace'  => $this->namespace,
        ], function (Router $router) {
            require base_path('routes/web.php');
        });
    }
}
`;

/** koel BroadcastServiceProvider::boot (real shape @ dfec91f): bare require, no group. */
const KOEL_BROADCAST_PROVIDER = `<?php

namespace App\\Providers;

use Illuminate\\Support\\Facades\\Broadcast;
use Illuminate\\Support\\ServiceProvider;

class BroadcastServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Broadcast::routes();

        require base_path('routes/channels.php');
    }
}
`;

/** 1-based line of the first line containing `needle` (fixture anchor helper). */
function lineOf(text: string, needle: string): number {
  const index = text.split(/\r?\n/u).findIndex((line) => line.includes(needle));
  if (index === -1) throw new Error(`fixture lacks ${needle}`);
  return index + 1;
}

function interchange(
  overrides: Partial<RouteInventoryInterchange> = {},
): RouteInventoryInterchange {
  return {
    schemaVersion: 1,
    packId: 'arxic-langpack-php@1.0.0',
    language: 'php',
    framework: 'laravel',
    standIn: false,
    provenance: { repository: 'https://github.com/BookStackApp/BookStack.git', commit: COMMIT },
    routes: [
      {
        methods: ['GET'],
        uri: '/books',
        sourcePath: 'routes/api.php',
        startLine: 10,
        endLine: 10,
      },
      {
        methods: ['GET'],
        uri: '/books',
        sourcePath: 'routes/web.php',
        startLine: 20,
        endLine: 20,
      },
    ],
    gaps: [
      {
        kind: 'unresolved-file',
        sourcePath: 'app/App/Providers/RouteServiceProvider.php',
        startLine: lineOf(BOOKSTACK_API_PROVIDER, 'require base_path'),
        endLine: lineOf(BOOKSTACK_API_PROVIDER, 'require base_path'),
        reason: 'includes route file routes/api.php (including group context not applied)',
        estimatedRouteCount: 78,
      },
    ],
    files: [
      { path: 'routes/api.php', sha256: '1'.repeat(64) },
      { path: 'routes/web.php', sha256: '2'.repeat(64) },
    ],
    ...overrides,
  };
}

const reader =
  (files: Record<string, string>) =>
  async (path: string): Promise<string | null> =>
    files[path] ?? null;

describe('provider-include prefix resolution — sad paths first', () => {
  it('leaves the interchange untouched (gap intact) when no file reader can see the provider', async () => {
    const input = interchange();
    const result = await resolveProviderIncludes({
      interchanges: [input],
      readUtf8: async () => null,
    });

    expect(result.resolutions).toHaveLength(0);
    expect(result.unresolved).toEqual([
      expect.objectContaining({
        gap: expect.objectContaining({
          kind: 'unresolved-file',
          sourcePath: 'app/App/Providers/RouteServiceProvider.php',
        }),
        reason: expect.stringContaining('provider file unavailable'),
      }),
    ]);
    expect(result.interchanges[0]).toEqual(input);
  });

  it('never resolves an include whose path is computed at runtime (koel RouteServiceProvider shape)', async () => {
    const dynamicGap: InterchangeGap = {
      kind: 'unresolved-file',
      sourcePath: 'app/Providers/RouteServiceProvider.php',
      startLine: 16,
      endLine: 16,
      reason: 'includes a route file whose path is computed at runtime',
    };
    const result = await resolveProviderIncludes({
      interchanges: [interchange({ gaps: [dynamicGap] })],
      readUtf8: async () => "Route::group([], base_path(sprintf('routes/%s.base.php', $type)));",
    });

    expect(result.resolutions).toHaveLength(0);
    expect(result.unresolved[0]?.reason).toContain('no literal included file');
  });

  it('treats an include with NO provable enclosing group as UNRESOLVED (koel channels.php shape) — an unproven context is never defaulted to empty', async () => {
    const channelsGap: InterchangeGap = {
      kind: 'unresolved-file',
      sourcePath: 'app/Providers/BroadcastServiceProvider.php',
      startLine: lineOf(KOEL_BROADCAST_PROVIDER, 'require base_path'),
      endLine: lineOf(KOEL_BROADCAST_PROVIDER, 'require base_path'),
      reason: 'includes route file routes/channels.php (including group context not applied)',
      estimatedRouteCount: 0,
    };
    const result = await resolveProviderIncludes({
      interchanges: [
        interchange({
          routes: [],
          gaps: [channelsGap],
          files: [{ path: 'routes/channels.php', sha256: '3'.repeat(64) }],
        }),
      ],
      readUtf8: reader({ 'app/Providers/BroadcastServiceProvider.php': KOEL_BROADCAST_PROVIDER }),
    });

    // Conservative by design: a bare require has no group context we can
    // PROVE from source; defaulting the prefix to [] would be a guess. The
    // gap stays visible with its honest 0-route estimate.
    expect(result.resolutions).toHaveLength(0);
    expect(result.unresolved[0]?.reason).toContain('no enclosing Route::group');
    expect(result.interchanges[0].gaps).toHaveLength(1);
  });

  it('leaves the gap when the provider text has no prefix-bearing group near the anchor', async () => {
    const provider = `<?php\n// a provider with unrelated content around the anchor\nclass Other\n{\n}\n`;
    const anchor = lineOf(provider, 'class Other');
    const result = await resolveProviderIncludes({
      interchanges: [
        interchange({
          gaps: [
            {
              kind: 'unresolved-file',
              sourcePath: 'app/App/Providers/RouteServiceProvider.php',
              startLine: anchor,
              endLine: anchor,
              reason: 'includes route file routes/api.php (including group context not applied)',
            },
          ],
        }),
      ],
      readUtf8: reader({ 'app/App/Providers/RouteServiceProvider.php': provider }),
    });

    expect(result.resolutions).toHaveLength(0);
    expect(result.unresolved[0]?.reason).toContain('no enclosing Route::group');
    expect(result.interchanges[0].gaps).toHaveLength(1);
  });

  it('leaves the gap when the anchor is outside the provider file (stale or mismatched gap)', async () => {
    const result = await resolveProviderIncludes({
      interchanges: [
        interchange({ gaps: [{ ...interchange().gaps[0]!, startLine: 999, endLine: 999 }] }),
      ],
      readUtf8: reader({ 'app/App/Providers/RouteServiceProvider.php': BOOKSTACK_API_PROVIDER }),
    });

    expect(result.resolutions).toHaveLength(0);
    expect(result.unresolved[0]?.reason).toContain('outside the provider file');
  });
});

describe('provider-include prefix resolution — composition', () => {
  it('applies the including group prefix to every route of the included file (BookStack api)', async () => {
    const result = await resolveProviderIncludes({
      interchanges: [interchange()],
      readUtf8: reader({ 'app/App/Providers/RouteServiceProvider.php': BOOKSTACK_API_PROVIDER }),
    });

    expect(result.resolutions).toEqual([
      {
        providerPath: 'app/App/Providers/RouteServiceProvider.php',
        includeLine: lineOf(BOOKSTACK_API_PROVIDER, 'require base_path'),
        includedFile: 'routes/api.php',
        prefixSegments: ['api'],
        appliedRoutes: 1,
        estimatedRouteCount: 78,
      },
    ]);
    const uris = result.interchanges[0].routes.map((route) => route.uri);
    expect(uris).toEqual(['/api/books', '/books']); // api row prefixed; web row untouched
    expect(result.interchanges[0].gaps).toHaveLength(0);
    // The derived interchange stays valid under the real fail-closed validator.
    expect(validateInterchange(result.interchanges[0]).ok).toBe(true);
  });

  it('resolves a prefix-less group include without rewriting URIs (BookStack web)', async () => {
    const webGap: InterchangeGap = {
      kind: 'unresolved-file',
      sourcePath: 'app/App/Providers/RouteServiceProvider.php',
      startLine: lineOf(BOOKSTACK_WEB_PROVIDER, 'require base_path'),
      endLine: lineOf(BOOKSTACK_WEB_PROVIDER, 'require base_path'),
      reason: 'includes route file routes/web.php (including group context not applied)',
      estimatedRouteCount: 260,
    };
    const result = await resolveProviderIncludes({
      interchanges: [interchange({ gaps: [webGap] })],
      readUtf8: reader({ 'app/App/Providers/RouteServiceProvider.php': BOOKSTACK_WEB_PROVIDER }),
    });

    expect(result.resolutions[0]).toMatchObject({
      includedFile: 'routes/web.php',
      prefixSegments: [],
      appliedRoutes: 1,
    });
    expect(result.interchanges[0].routes.map((route) => route.uri)).toEqual(['/books', '/books']);
  });

  it('composes chained ->prefix() segments before the group (multi-segment prefix)', async () => {
    const chained = `<?php
Route::prefix('api')->prefix('v2')->group(function () {
    require base_path('routes/api.php');
});
`;
    const anchor = lineOf(chained, 'require base_path');
    const result = await resolveProviderIncludes({
      interchanges: [
        interchange({ gaps: [{ ...interchange().gaps[0]!, startLine: anchor, endLine: anchor }] }),
      ],
      readUtf8: reader({ 'app/App/Providers/RouteServiceProvider.php': chained }),
    });

    expect(result.resolutions[0]?.prefixSegments).toEqual(['api', 'v2']);
    expect(result.interchanges[0].routes[0]?.uri).toBe('/api/v2/books');
  });

  it('prefixes a root uri to the prefix itself (Laravel prefix semantics)', async () => {
    const result = await resolveProviderIncludes({
      interchanges: [
        interchange({
          routes: [
            { methods: ['GET'], uri: '/', sourcePath: 'routes/api.php', startLine: 5, endLine: 5 },
          ],
        }),
      ],
      readUtf8: reader({ 'app/App/Providers/RouteServiceProvider.php': BOOKSTACK_API_PROVIDER }),
    });

    expect(result.interchanges[0].routes[0]?.uri).toBe('/api');
    expect(validateInterchange(result.interchanges[0]).ok).toBe(true);
  });

  it('deterministically re-orders the derived routes (byte-stable two-pass output)', async () => {
    const build = () =>
      resolveProviderIncludes({
        interchanges: [interchange()],
        readUtf8: reader({ 'app/App/Providers/RouteServiceProvider.php': BOOKSTACK_API_PROVIDER }),
      });
    const first = await build();
    const second = await build();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('provider-include prefix resolution — real BookStack interchange artifact', () => {
  const evidencePath = resolve(
    fileURLToPath(import.meta.url),
    '../../../../../docs/evidence/DG-05/bookstack-arxic-langpack-php-interchange.json',
  );

  /**
   * The real provider, padded so the two include statements sit at the REAL
   * anchored lines 49 and 72 (mapWebRoutes / mapApiRoutes,
   * app/App/Providers/RouteServiceProvider.php @ c813c1b — verified: `sed -n
   * '49p;72p'` on the pinned clone prints both requires). Statement shape
   * verbatim; filler lines are comments so the fixture stays reviewable.
   */
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

  it('the fixture reproduces the real artifact anchors (lines 49 and 72)', () => {
    expect(lineOf(BOOKSTACK_PROVIDER, "base_path('routes/web.php')")).toBe(49);
    expect(lineOf(BOOKSTACK_PROVIDER, "base_path('routes/api.php')")).toBe(72);
  });

  it('resolves BOTH provider includes on the committed real artifact: 9 URI collisions dissolve', async () => {
    const artifact = JSON.parse(await readFile(evidencePath, 'utf8')) as RouteInventoryInterchange;
    expect(artifact.gaps.filter((gap) => gap.kind === 'unresolved-file')).toHaveLength(2);

    const result = await resolveProviderIncludes({
      interchanges: [artifact],
      readUtf8: reader({ 'app/App/Providers/RouteServiceProvider.php': BOOKSTACK_PROVIDER }),
    });

    expect(result.resolutions).toEqual([
      expect.objectContaining({
        includedFile: 'routes/web.php',
        prefixSegments: [],
        appliedRoutes: 257,
      }),
      expect.objectContaining({
        includedFile: 'routes/api.php',
        prefixSegments: ['api'],
        appliedRoutes: 78,
      }),
    ]);
    // Route mass is conserved: 335 in, 335 out (only URIs change).
    expect(result.interchanges[0].routes).toHaveLength(335);
    expect(result.interchanges[0].gaps).toHaveLength(1); // only the blade parse-error remains
    // The previously colliding pair splits into two distinct surfaces.
    const books = result.interchanges[0].routes
      .filter((route) => route.uri === '/api/books' || route.uri === '/books')
      .map((route) => `${route.methods.join('|')} ${route.uri} (${route.sourcePath})`);
    expect(books).toContain('GET /api/books (routes/api.php)');
    expect(validateInterchange(result.interchanges[0]).ok).toBe(true);
  });
});
