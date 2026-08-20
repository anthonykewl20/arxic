<?php

use App\Http\Controllers\API\Auth\LoginWithCredentialsController;
use App\Http\Controllers\API\Auth\TwoFactorChallengeController;
use Illuminate\Support\Facades\Route;

// Real koel routes/api.base.php shape (Laravel 13 facade registrations).
Route::post('me', LoginWithCredentialsController::class)->name('auth.login');
Route::post('me/two-factor-challenge', TwoFactorChallengeController::class);
Route::get('ping', static fn () => null);
Route::delete('me', App\Http\Controllers\API\Auth\LogoutController::class);
