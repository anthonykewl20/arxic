import { describe, expect, it } from 'vitest';
import { expandResource } from '../language-packs/php/laravel-resources';

describe('Laravel ResourceRegistrar expansion (ported from laravel/framework v13.24.0)', () => {
  it('expends a plain resource into the 7 canonical verb routes', () => {
    // ResourceRegistrar::register + addResource{Index,Create,Store,Show,Edit,Update,Destroy}
    expect(expandResource('photos', 'PhotoController')).toEqual([
      { method: 'GET', uri: 'photos', action: 'index' },
      { method: 'GET', uri: 'photos/create', action: 'create' },
      { method: 'POST', uri: 'photos', action: 'store' },
      { method: 'GET', uri: 'photos/{photo}', action: 'show' },
      { method: 'GET', uri: 'photos/{photo}/edit', action: 'edit' },
      { method: 'PUT', uri: 'photos/{photo}', action: 'update' },
      { method: 'PATCH', uri: 'photos/{photo}', action: 'update' },
      { method: 'DELETE', uri: 'photos/{photo}', action: 'destroy' },
    ]);
  });

  it('expands an apiResource into the 5 api verbs (Router::apiResource only-list)', () => {
    // Router.php:382-393 — only = [index, show, store, update, destroy], minus except.
    expect(expandResource('albums', 'AlbumController', { api: true })).toEqual([
      { method: 'GET', uri: 'albums', action: 'index' },
      { method: 'POST', uri: 'albums', action: 'store' },
      { method: 'GET', uri: 'albums/{album}', action: 'show' },
      { method: 'PUT', uri: 'albums/{album}', action: 'update' },
      { method: 'PATCH', uri: 'albums/{album}', action: 'update' },
      { method: 'DELETE', uri: 'albums/{album}', action: 'destroy' },
    ]);
  });

  it('expands nested dot-notation resources like getResourceUri does (albums.songs)', () => {
    // getResourceUri('albums.songs') = 'albums/{album}/songs' (trailing param stripped,
    // then re-added per verb), base wildcard singularized from the last segment.
    expect(expandResource('albums.songs', 'AlbumSongController', { api: true })).toEqual([
      { method: 'GET', uri: 'albums/{album}/songs', action: 'index' },
      { method: 'POST', uri: 'albums/{album}/songs', action: 'store' },
      { method: 'GET', uri: 'albums/{album}/songs/{song}', action: 'show' },
      { method: 'PUT', uri: 'albums/{album}/songs/{song}', action: 'update' },
      { method: 'PATCH', uri: 'albums/{album}/songs/{song}', action: 'update' },
      { method: 'DELETE', uri: 'albums/{album}/songs/{song}', action: 'destroy' },
    ]);
  });

  it('applies only/except modifiers exactly like getResourceMethods', () => {
    // koel routes/api.base.php:167-169 — apiResource('songs', …)->except('update', 'destroy')
    expect(
      expandResource('songs', 'SongController', { api: true, except: ['update', 'destroy'] }),
    ).toEqual([
      { method: 'GET', uri: 'songs', action: 'index' },
      { method: 'POST', uri: 'songs', action: 'store' },
      { method: 'GET', uri: 'songs/{song}', action: 'show' },
    ]);
    expect(expandResource('users', 'UserController', { api: true, only: ['index'] })).toEqual([
      { method: 'GET', uri: 'users', action: 'index' },
    ]);
  });

  it('supports slash-prefixed resource names via prefixedResource', () => {
    // ResourceRegistrar::prefixedResource — 'admin/photos' becomes prefix 'admin'.
    expect(expandResource('admin/photos', 'PhotoController', { api: true })).toEqual([
      { method: 'GET', uri: 'admin/photos', action: 'index' },
      { method: 'POST', uri: 'admin/photos', action: 'store' },
      { method: 'GET', uri: 'admin/photos/{photo}', action: 'show' },
      { method: 'PUT', uri: 'admin/photos/{photo}', action: 'update' },
      { method: 'PATCH', uri: 'admin/photos/{photo}', action: 'update' },
      { method: 'DELETE', uri: 'admin/photos/{photo}', action: 'destroy' },
    ]);
  });

  it("keeps singular resources singular (koel apiResource('user', …))", () => {
    expect(expandResource('user', 'UserController', { api: true, only: ['index'] })).toEqual([
      { method: 'GET', uri: 'user', action: 'index' },
    ]);
  });
});
