import { describe, expect, it } from 'vitest';
import { singularize } from '../language-packs/php/singularize';

describe('doctrine/inflector 2.1.0 English singular port (Laravel Str::singular)', () => {
  it('singularizes the regular plurals that occur in real resource names', () => {
    // Words drawn from koel/BookStack route inventories (albums.songs, playlists, shelves…).
    for (const [plural, singular] of [
      ['albums', 'album'],
      ['songs', 'song'],
      ['artists', 'artist'],
      ['playlists', 'playlist'],
      ['users', 'user'],
      ['genres', 'genre'],
      ['podcasts', 'podcast'],
      ['episodes', 'episode'],
      ['stations', 'station'],
      ['themes', 'theme'],
      ['books', 'book'],
      ['pages', 'page'],
      ['chapters', 'chapter'],
      ['shelves', 'shelf'],
      ['roles', 'role'],
      ['attachments', 'attachment'],
      ['tags', 'tag'],
      ['tokens', 'token'],
      ['imports', 'import'],
    ] as const) {
      expect(singularize(plural), plural).toBe(singular);
    }
  });

  it('keeps doctrine-uninflected and irregular words exact', () => {
    // data/fish/series are doctrine Uninflected::getSingular() entries; the rest hit
    // irregular substitution or explicit singular transformations.
    for (const [plural, singular] of [
      ['data', 'data'],
      ['fish', 'fish'],
      ['series', 'series'],
      ['people', 'person'],
      ['children', 'child'],
      ['men', 'man'],
      ['feet', 'foot'],
      ['teeth', 'tooth'],
      ['criteria', 'criterion'],
      ['moves', 'move'],
      ['quizzes', 'quiz'],
      ['buses', 'bus'],
      ['boxes', 'box'],
      ['wives', 'wife'],
      ['cities', 'city'],
      ['knives', 'knife'],
      ['statuses', 'status'],
      ['houses', 'house'],
      ['analyses', 'analysis'],
    ] as const) {
      expect(singularize(plural), plural).toBe(singular);
    }
  });

  it('passes singular words through unchanged (doctrine s$ rule is greedy but idempotent-safe)', () => {
    expect(singularize('song')).toBe('song');
    expect(singularize('class')).toBe('class'); // '.*ss' uninflected
    expect(singularize('status')).toBe('status');
  });
});
