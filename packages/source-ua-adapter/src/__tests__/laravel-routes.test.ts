import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '@arxic/contracts';
import {
  inventoryLaravelRoutes,
  type LaravelRouteRow,
  type RepoFileAccess,
} from '../language-packs/php/laravel-routes';
import { SourceParser } from '../parser';

// Real tree-sitter-php engine (no mocks): every snippet below is a shape verified
// against koel/routes/{api.base,web.base,subsonic}.php (Laravel 13, composer.lock
// laravel/framework v13.24.0) or bookstack/routes/web.php (Laravel 12) at the cited lines.

function parse(source: string) {
  const parser = new SourceParser();
  const parsed = parser.parse('routes/api.php', 'php', source);
  return parsed;
}

function rows(routes: LaravelRouteRow[]): string[] {
  return routes.map((route) => `${route.method} ${route.uri}`);
}

function accessWith(files: Record<string, string>): RepoFileAccess {
  return {
    async readRelative(path) {
      if (path in files) return { ok: true, text: files[path] ?? '' };
      return { ok: false, reason: 'not-found' };
    },
  };
}

const COMPOSER = JSON.stringify({
  name: 'acme/demo',
  require: { 'laravel/framework': '^13.0' },
  autoload: { 'psr-4': { 'App\\': 'app/' } },
});

const SONG_CONTROLLER = `<?php

namespace App\\Http\\Controllers;

class SongController
{
    public function index()
    {
        return [];
    }

    public function update()
    {
        return [];
    }
}
`;

describe('Laravel route inventory — sad paths first (never silent)', () => {
  it('advises ARXIC-SOURCE-ROUTE-DYNAMIC-REGISTRATION for an unresolvable interpolated route', async () => {
    const source = `<?php
use App\\Http\\Controllers\\SongController;
use Illuminate\\Support\\Facades\\Route;

Route::match(['get', 'post'], "{$prefix}/ping", SongController::class);
`;
    const result = await inventoryLaravelRoutes({
      path: 'routes/api.php',
      parsed: parse(source),
      access: accessWith({ 'composer.json': COMPOSER }),
    });
    expect(result.routes).toEqual([]);
    expect(result.advisories.map((a) => a.code)).toEqual([
      'ARXIC-SOURCE-ROUTE-DYNAMIC-REGISTRATION',
    ]);
    const advisory = result.advisories[0] as Diagnostic;
    expect(advisory.severity).toBe('observed');
    expect(advisory.subject).toBe('routes/api.php');
  });

  it('advises ARXIC-SOURCE-ROUTE-DYNAMIC-REGISTRATION for a foreach over a non-literal array', async () => {
    const source = `<?php
use Illuminate\\Support\\Facades\\Route;

foreach (config('subsonic.endpoints') as $endpoint => $controller) {
    Route::match(['get', 'post'], "{$endpoint}", $controller);
}
`;
    const result = await inventoryLaravelRoutes({
      path: 'routes/api.php',
      parsed: parse(source),
      access: accessWith({ 'composer.json': COMPOSER }),
    });
    expect(result.routes).toEqual([]);
    expect(result.advisories.map((a) => a.code)).toEqual([
      'ARXIC-SOURCE-ROUTE-DYNAMIC-REGISTRATION',
    ]);
  });

  it('advises ARXIC-SOURCE-HANDLER-UNRESOLVED when the controller class has no psr-4 file', async () => {
    const source = `<?php
use App\\Http\\Controllers\\GhostController;
use Illuminate\\Support\\Facades\\Route;

Route::get('ghosts', [GhostController::class, 'index']);
`;
    const result = await inventoryLaravelRoutes({
      path: 'routes/api.php',
      parsed: parse(source),
      access: accessWith({ 'composer.json': COMPOSER }),
    });
    expect(rows(result.routes)).toEqual(['GET /ghosts']);
    expect(result.handlerRefs).toEqual([]);
    expect(result.advisories.map((a) => a.code)).toEqual(['ARXIC-SOURCE-HANDLER-UNRESOLVED']);
  });

  it('advises ARXIC-SOURCE-HANDLER-UNRESOLVED when the controller file lacks the referenced method', async () => {
    const source = `<?php
use App\\Http\\Controllers\\SongController;
use Illuminate\\Support\\Facades\\Route;

Route::get('songs', [SongController::class, 'missingAction']);
`;
    const result = await inventoryLaravelRoutes({
      path: 'routes/api.php',
      parsed: parse(source),
      access: accessWith({
        'composer.json': COMPOSER,
        'app/Http/Controllers/SongController.php': SONG_CONTROLLER,
      }),
    });
    expect(rows(result.routes)).toEqual(['GET /songs']);
    expect(result.handlerRefs).toEqual([]);
    expect(result.advisories.map((a) => a.code)).toEqual(['ARXIC-SOURCE-HANDLER-UNRESOLVED']);
  });

  it('advises on a resource route whose controller file is unresolvable (apiResource rows still emitted)', async () => {
    const source = `<?php
use App\\Http\\Controllers\\AlbumController;
use Illuminate\\Support\\Facades\\Route;

Route::apiResource('albums', AlbumController::class);
`;
    const result = await inventoryLaravelRoutes({
      path: 'routes/api.php',
      parsed: parse(source),
      access: accessWith({ 'composer.json': COMPOSER }),
    });
    expect(rows(result.routes)).toEqual([
      'GET /albums',
      'POST /albums',
      'GET /albums/{album}',
      'PUT /albums/{album}',
      'PATCH /albums/{album}',
      'DELETE /albums/{album}',
    ]);
    expect(result.handlerRefs).toEqual([]);
    expect(result.advisories.every((a) => a.code === 'ARXIC-SOURCE-HANDLER-UNRESOLVED')).toBe(true);
    expect(result.advisories.length).toBe(5); // one per distinct action
  });
});

describe('Laravel route inventory — koel api.base.php shapes (Laravel 13)', () => {
  const FILES = {
    'composer.json': COMPOSER,
    'app/Http/Controllers/API/SongController.php': `<?php

namespace App\\Http\\Controllers\\API;

class SongController
{
    public function index()
    {
    }

    public function store()
    {
    }

    public function show()
    {
    }

    public function update()
    {
    }

    public function destroy()
    {
    }

    public function __invoke()
    {
    }
}
`,
  };

  it('resolves fluent prefix/middleware/group chains with nested groups and apiResource + except', async () => {
    // Mirrors koel routes/api.base.php:101-172 structure.
    const source = `<?php

use App\\Http\\Controllers\\API\\SongController;
use Illuminate\\Support\\Facades\\Route;

Route::prefix('api')
    ->middleware('api')
    ->group(static function (): void {
        Route::get('ping', static fn () => null);

        Route::middleware('auth')->group(static function (): void {
            Route::get('one-time-token', \\App\\Http\\Controllers\\API\\SongController::class);

            Route::apiResource('songs', SongController::class)
                ->except('update', 'destroy')
                ->where(['song' => 'x']);

            Route::put('songs', [SongController::class, 'update']);
            Route::delete('songs', [SongController::class, 'destroy']);
        });
    });
`;
    const result = await inventoryLaravelRoutes({
      path: 'routes/api.base.php',
      parsed: parse(source),
      access: accessWith(FILES),
    });
    expect(rows(result.routes)).toEqual([
      'GET /api/ping',
      'GET /api/one-time-token',
      'GET /api/songs',
      'POST /api/songs',
      'GET /api/songs/{song}',
      'PUT /api/songs',
      'DELETE /api/songs',
    ]);
    // Closure and invokable handlers anchor inside the routes file; method handlers
    // anchor inside the controller file.
    const handler = result.handlerRefs.find((ref) => ref.method === 'update');
    expect(handler).toMatchObject({
      controller: 'App\\Http\\Controllers\\API\\SongController',
      path: 'app/Http/Controllers/API/SongController.php',
    });
    expect(handler?.startLine).toBeGreaterThan(0);
    expect(result.advisories).toEqual([]);
  });

  it('expands a literal foreach with string interpolation (subsonic pattern) into concrete routes', async () => {
    // Mirrors koel routes/subsonic.php:59-118.
    const source = `<?php

use App\\Http\\Controllers\\Subsonic\\PingController;
use App\\Http\\Controllers\\Subsonic\\GetLicenseController;
use Illuminate\\Support\\Facades\\Route;

$endpoints = [
    'ping' => PingController::class,
    'getLicense' => GetLicenseController::class,
];

Route::prefix('rest')
    ->group(static function () use ($endpoints): void {
        foreach ($endpoints as $endpoint => $controller) {
            Route::match(['get', 'post'], "{$endpoint}{format?}", $controller)->where('format', '\\\\.view');
        }
    });
`;
    const result = await inventoryLaravelRoutes({
      path: 'routes/subsonic.php',
      parsed: parse(source),
      access: accessWith({
        'composer.json': COMPOSER,
        'app/Http/Controllers/Subsonic/PingController.php': `<?php

namespace App\\Http\\Controllers\\Subsonic;

class PingController
{
    public function __invoke()
    {
    }
}
`,
      }),
    });
    expect(rows(result.routes)).toEqual([
      'GET /rest/ping{format?}',
      'POST /rest/ping{format?}',
      'GET /rest/getLicense{format?}',
      'POST /rest/getLicense{format?}',
    ]);
    expect(result.handlerRefs.map((r) => `${r.controller}::${r.method}`)).toContain(
      'App\\Http\\Controllers\\Subsonic\\PingController::__invoke',
    );
    // Only PingController exists on disk; getLicense is unresolvable but visible.
    expect(result.advisories.map((a) => a.code)).toEqual(['ARXIC-SOURCE-HANDLER-UNRESOLVED']);
  });

  it('includes routes declared inside if-blocks and array-attribute groups', async () => {
    // koel routes/api.base.php:254-256 (YouTube::enabled) and 299-302 (['prefix' => 'radio']).
    const source = `<?php

use App\\Facades\\YouTube;
use App\\Http\\Controllers\\API\\SongController;
use Illuminate\\Support\\Facades\\Route;

Route::group(['prefix' => 'radio'], static function (): void {
    if (YouTube::enabled()) {
        Route::get('stations', [SongController::class, 'index']);
    }
});
`;
    const result = await inventoryLaravelRoutes({
      path: 'routes/api.php',
      parsed: parse(source),
      access: accessWith(FILES),
    });
    expect(rows(result.routes)).toEqual(['GET /radio/stations']);
  });

  it('resolves aliased use imports (koel ConfirmTwoFactorController pattern)', async () => {
    const source = `<?php

use App\\Http\\Controllers\\API\\SongController as TrackController;
use Illuminate\\Support\\Facades\\Route;

Route::get('tracks', [TrackController::class, 'index']);
`;
    const result = await inventoryLaravelRoutes({
      path: 'routes/api.php',
      parsed: parse(source),
      access: accessWith(FILES),
    });
    expect(rows(result.routes)).toEqual(['GET /tracks']);
    expect(result.handlerRefs[0]?.controller).toBe('App\\Http\\Controllers\\API\\SongController');
  });
});

describe('Laravel route inventory — BookStack shapes (Laravel 12)', () => {
  const FILES = {
    'composer.json': JSON.stringify({
      name: 'bookstack/demo',
      autoload: { 'psr-4': { 'BookStack\\': 'app/' } },
    }),
    'app/Settings/StatusController.php': `<?php

namespace BookStack\\Settings;

class StatusController
{
    public function show()
    {
    }
}
`,
  };

  it('normalizes leading/trailing slashes and namespace-alias class references', async () => {
    // Mirrors bookstack/routes/web.php:24-26 with `use BookStack\Settings as SettingControllers;`
    const source = `<?php

use BookStack\\Settings as SettingControllers;
use Illuminate\\Support\\Facades\\Route;

Route::get('/status', [SettingControllers\\StatusController::class, 'show']);
Route::get('/shelves/', [SettingControllers\\StatusController::class, 'show']);
`;
    const result = await inventoryLaravelRoutes({
      path: 'routes/web.php',
      parsed: parse(source),
      access: accessWith(FILES),
    });
    expect(rows(result.routes)).toEqual(['GET /status', 'GET /shelves']);
    expect(result.handlerRefs[0]).toMatchObject({
      controller: 'BookStack\\Settings\\StatusController',
      path: 'app/Settings/StatusController.php',
    });
  });

  it('resolves legacy string controllers through the App\\Http\\Controllers fallback', async () => {
    const source = `<?php

use Illuminate\\Support\\Facades\\Route;

Route::post('/login', 'Auth\\LoginController@login');
`;
    const result = await inventoryLaravelRoutes({
      path: 'routes/web.php',
      parsed: parse(source),
      access: accessWith({
        'composer.json': COMPOSER,
        'app/Http/Controllers/Auth/LoginController.php': `<?php

namespace App\\Http\\Controllers\\Auth;

class LoginController
{
    public function login()
    {
    }
}
`,
      }),
    });
    expect(rows(result.routes)).toEqual(['POST /login']);
    expect(result.handlerRefs[0]).toMatchObject({
      controller: 'App\\Http\\Controllers\\Auth\\LoginController',
      method: 'login',
    });
  });
});

describe('Laravel route inventory — anchors', () => {
  it('anchors every route row on the Route:: call expression line range', async () => {
    const source = `<?php

use Illuminate\\Support\\Facades\\Route;

Route::get(
    'ping',
    static fn () => null
);
`;
    const result = await inventoryLaravelRoutes({
      path: 'routes/api.php',
      parsed: parse(source),
      access: accessWith({ 'composer.json': COMPOSER }),
    });
    expect(result.routes[0]?.startLine).toBe(5);
    expect(result.routes[0]?.endLine).toBe(8);
  });
});
