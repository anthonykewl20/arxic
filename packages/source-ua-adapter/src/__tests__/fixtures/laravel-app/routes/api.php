<?php

// Arxic-authored fixture (MIT). Shapes mirror koel routes/api.base.php
// (Laravel 13, laravel/framework v13.24.0) — fluent prefix/middleware group
// chains, nested middleware groups, apiResource with except, invokable
// controllers, [Controller::class, 'method'] pairs, optional parameters,
// conditional if-blocks, and the subsonic-style literal foreach.

use App\Http\Controllers\API\AlbumController;
use App\Http\Controllers\API\PlaylistController;
use App\Http\Controllers\API\SongController;
use App\Http\Controllers\API\UserController;
use App\Http\Controllers\API\FetchOverviewController as OverviewController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

$apiEndpoints = [
    'health' => \App\Http\Controllers\API\HealthController::class,
];

Route::prefix('api')
    ->middleware('api')
    ->group(static function (): void {
        Route::get('ping', static fn () => null);

        Route::match(['get', 'post'], 'echo', static fn (Request $request) => $request->all());

        Route::middleware('throttle:10,1')->group(static function (): void {
            Route::post('me', \App\Http\Controllers\API\LoginController::class)->name('auth.login');
            Route::delete('me', \App\Http\Controllers\API\LogoutController::class);
        });

        Route::middleware('auth')->group(static function (): void {
            Route::get('overview', OverviewController::class);

            Route::apiResource('albums', AlbumController::class);
            Route::apiResource('albums.songs', \App\Http\Controllers\API\AlbumSongController::class)
                ->except('update', 'destroy');

            Route::get('songs/recently-played', [SongController::class, 'recentlyPlayed']);
            Route::put('songs/{song}/rating', [SongController::class, 'rate'])
                ->where(['song' => '[0-9a-f-]{36}']);

            Route::get('playlists/{playlist?}/songs', [PlaylistController::class, 'songs']);

            if (config('fixture.features.users')) {
                Route::apiResource('users', UserController::class)->only(['index', 'store']);
            }

            Route::group(['prefix' => 'radio'], static function (): void {
                Route::get('stations', [\App\Http\Controllers\API\RadioStationController::class, 'index']);
            });
        });
    });

Route::prefix('rest')->group(static function () use ($apiEndpoints): void {
    foreach ($apiEndpoints as $endpoint => $controller) {
        Route::get("{$endpoint}{format?}", $controller)->where('format', '\.view');
    }
});
