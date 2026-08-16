<?php

// Arxic-authored fixture (MIT). Shapes mirror bookstack/routes/web.php
// (Laravel 12) — leading/trailing slashes, legacy string controllers — plus
// Laravel's redirect/view/fallback verbs.

use App\Http\Controllers\IndexController;
use Illuminate\Support\Facades\Route;

Route::get('/', IndexController::class)->name('home');

Route::middleware('web')->group(static function (): void {
    Route::get('/status', [\App\Http\Controllers\StatusController::class, 'show']);
    Route::get('/shelves/', [\App\Http\Controllers\ShelfController::class, 'index']);
    Route::post('/shelves/', [\App\Http\Controllers\ShelfController::class, 'store']);

    Route::post('/login', 'Auth\LoginController@login');
    Route::post('/logout', 'Auth\LoginController@logout');

    Route::redirect('/legacy', '/', 301);
    Route::view('/about', 'about', []);
    Route::fallback(\App\Http\Controllers\MissingController::class);
});
