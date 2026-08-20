<?php

use Illuminate\Support\Facades\Route;

// Not the Route facade: an instance call on a variable receiver.
$router->post('/login', fn () => null);

// A different class entirely: the receiver must be Route.
Residence::get('/login', fn () => null);

// Non-HTTP-verb facade method: 'middleware' is not a route registration.
Route::middleware('web')->group(static function (): void {
    // No direct registration inside the group in this file.
});

// Non-literal path: the rule requires a quoted string so dynamic paths are
// excluded from the direct-match class.
Route::get($dynamicPath, fn () => null);
