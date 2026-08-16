import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enumeratePhpRoutes } from '..';

/**
 * The PHP enumerator is an explicitly marked STAND-IN for the DG-01/DG-05
 * language pack (issue #246: "a stand-in deterministic enumerator you write for
 * the spike (e.g. routes-file scan)"). The PHP snippets below are modeled on
 * REAL shapes observed in koel/koel@dfec91f (routes/api.base.php,
 * routes/web.base.php, routes/subsonic.php) — every shape here exists verbatim
 * in that repository; the citation lives in docs/spikes/dg-02-domain-inventory.md.
 */

async function withRoutes(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dg02-standin-'));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(root, name, '..'), { recursive: true });
    await writeFile(join(root, name), content);
  }
  return root;
}

describe('stand-in PHP routes-file enumerator', () => {
  it('extracts simple verb routes with line anchors', async () => {
    const root = await withRoutes({
      'routes/web.php': `<?php
use Illuminate\\Support\\Facades\\Route;
Route::get('ping', static fn () => null);
Route::post('me', LoginWithCredentialsController::class)->name('auth.login');
`,
    });
    const result = await enumeratePhpRoutes(root);
    expect(result.standIn).toBe(true);
    const uris = result.routes.map((route) => `${route.methods.join('|')} ${route.uri}`);
    expect(uris).toEqual(['POST /me', 'GET /ping']);
    expect(result.routes[0]).toMatchObject({
      sourcePath: 'routes/web.php',
      startLine: 4,
      endLine: 4,
    });
    expect(result.routes[0]?.name).toBe('auth.login');
  });

  it('composes nested Route::prefix groups (koel api.base.php shape)', async () => {
    const root = await withRoutes({
      'routes/api.php': `<?php
Route::prefix('api')
    ->middleware('api')
    ->group(static function (): void {
        Route::get('ping', static fn () => null);
        Route::middleware('auth')->group(static function (): void {
            Route::get('me', [ProfileController::class, 'show']);
        });
    });
`,
    });
    const result = await enumeratePhpRoutes(root);
    const uris = result.routes.map((route) => route.uri);
    expect(uris).toEqual(['/api/me', '/api/ping']);
  });

  it('expands Route::apiResource into the five standard actions, including nested dot resources and except()', async () => {
    const root = await withRoutes({
      'routes/api.php': `<?php
Route::prefix('api')->group(static function (): void {
    Route::apiResource('albums', AlbumController::class);
    Route::apiResource('albums.songs', AlbumSongController::class);
    Route::apiResource('playlists', PlaylistController::class)->except('destroy');
});
`,
    });
    const result = await enumeratePhpRoutes(root);
    const keys = result.routes.map((route) => `${route.methods.join('|')} ${route.uri}`);
    expect(keys).toContain('GET /api/albums');
    expect(keys).toContain('POST /api/albums');
    expect(keys).toContain('GET /api/albums/{album}');
    expect(keys).toContain('PUT /api/albums/{album}');
    expect(keys).toContain('DELETE /api/albums/{album}');
    expect(keys).toContain('GET /api/albums/{album}/songs');
    expect(keys).toContain('DELETE /api/albums/{album}/songs/{song}');
    expect(keys).not.toContain('DELETE /api/playlists/{playlist}');
    expect(keys).toContain('GET /api/playlists');
  });

  it('flags routes registered inside if-blocks as conditional (koel web.base.php shape)', async () => {
    const root = await withRoutes({
      'routes/web.php': `<?php
Route::middleware('web')->group(static function (): void {
    if (config('koel.download.allow')) {
        Route::prefix('download')->group(static function (): void {
            Route::get('songs', DownloadSongsController::class);
        });
    }
});
`,
    });
    const result = await enumeratePhpRoutes(root);
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]?.conditional).toBe(true);
    expect(result.routes[0]?.uri).toBe('/download/songs');
  });

  it('records interpolated (loop-driven) URIs as dynamic-registration gaps, not fake routes (koel subsonic.php shape)', async () => {
    const root = await withRoutes({
      'routes/subsonic.php': `<?php
$endpoints = ['ping' => PingController::class];
Route::prefix('rest')
    ->middleware([AuthenticateSubsonicRequests::class])
    ->group(static function () use ($endpoints): void {
        foreach ($endpoints as $endpoint => $controller) {
            Route::match(['get', 'post'], "{$endpoint}{format?}", $controller)->where('format', '\\.view');
        }
    });
`,
    });
    const result = await enumeratePhpRoutes(root);
    expect(result.routes).toEqual([]);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toMatchObject({
      kind: 'dynamic-registration',
      sourcePath: 'routes/subsonic.php',
    });
  });

  it('handles Route::match with multiple methods and optional parameters', async () => {
    const root = await withRoutes({
      'routes/api.php': `<?php
Route::get('genres/{genre?}/songs', PaginateSongsByGenreController::class);
Route::match(['get', 'post'], 'both', DualController::class);
`,
    });
    const result = await enumeratePhpRoutes(root);
    const keys = result.routes.map((route) => `${route.methods.join('|')} ${route.uri}`);
    expect(keys).toEqual(['GET|POST /both', 'GET /genres/{genre?}/songs']);
  });

  it('scans non-standard route file names (koel web.base.php) without turning file names into prefixes', async () => {
    const root = await withRoutes({
      'routes/web.base.php': `<?php
Route::get('remote', static fn () => view('remote'));
`,
      'routes/api.base.php': `<?php
Route::get('ping', static fn () => null);
`,
    });
    const first = await enumeratePhpRoutes(root);
    const second = await enumeratePhpRoutes(root);
    expect(first.routes.map((route) => route.uri).sort()).toEqual(['/ping', '/remote']);
    expect(first.routes.every((route) => !route.uri.includes('base'))).toBe(true);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('reports unreadable/unparseable route files as gaps, never silently', async () => {
    const root = await withRoutes({
      'routes/broken.php': `<?php
Route::get(;
`,
    });
    const result = await enumeratePhpRoutes(root);
    expect(result.gaps.length).toBeGreaterThanOrEqual(1);
  });

  it('produces output that validates as an interchange', async () => {
    const root = await withRoutes({
      'routes/web.php': `<?php
Route::get('/health', fn () => ok());
`,
    });
    const result = await enumeratePhpRoutes(root);
    const { validateInterchange } = await import('..');
    expect(validateInterchange(result).ok).toBe(true);
  });
});

describe('stand-in absent-routes accounting', () => {
  it('a repository without a routes directory yields an explicit gap, never a silent zero', async () => {
    const root = await withRoutes({ 'composer.json': '{}' });
    const result = await enumeratePhpRoutes(root);
    expect(result.routes).toEqual([]);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toMatchObject({ kind: 'unresolved-file', sourcePath: 'routes/' });
    const { validateInterchange } = await import('..');
    expect(validateInterchange(result).ok).toBe(true);
  });
});
