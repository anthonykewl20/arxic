import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateDiagnostic, validateEvidenceRef } from '@arxic/contracts';
import { describe, expect, it } from 'vitest';
import { canonicalJson, SourceUaAdapter } from '../index';
import type { NormalizedSourceIndex } from '../normalize';
import { makeRepository } from './test-repo';

// End-to-end inventory of the Arxic-authored license-clean Laravel fixture
// (every controller referenced by the route files exists, so the expected
// inventory below is the COMPLETE declared surface — zero advisories).
// Route shapes are drawn from koel (Laravel 13.24.0) and BookStack (12.64.0).

const FIXTURE = resolve(import.meta.dirname, 'fixtures/laravel-app');

function preTimestamp(document: NormalizedSourceIndex): string {
  const stable: Partial<NormalizedSourceIndex> = { ...document };
  delete stable.generatedAt;
  return canonicalJson(stable as NormalizedSourceIndex);
}

const EXPECTED_ROUTES = [
  'GET /api/ping',
  'GET /api/echo',
  'POST /api/echo',
  'POST /api/me',
  'DELETE /api/me',
  'GET /api/overview',
  'GET /api/albums',
  'POST /api/albums',
  'GET /api/albums/{album}',
  'PUT /api/albums/{album}',
  'PATCH /api/albums/{album}',
  'DELETE /api/albums/{album}',
  'GET /api/albums/{album}/songs',
  'POST /api/albums/{album}/songs',
  'GET /api/albums/{album}/songs/{song}',
  'GET /api/songs/recently-played',
  'PUT /api/songs/{song}/rating',
  'GET /api/playlists/{playlist?}/songs',
  'GET /api/users',
  'POST /api/users',
  'GET /api/radio/stations',
  'GET /rest/health{format?}',
  'GET /',
  'GET /status',
  'GET /shelves',
  'POST /shelves',
  'POST /login',
  'POST /logout',
  'GET /legacy',
  'GET /about',
  'ANY /',
];

const EXPECTED_HANDLERS = [
  'App\\Http\\Controllers\\API\\HealthController::__invoke',
  'App\\Http\\Controllers\\API\\LoginController::__invoke',
  'App\\Http\\Controllers\\API\\LogoutController::__invoke',
  'App\\Http\\Controllers\\API\\FetchOverviewController::__invoke',
  'App\\Http\\Controllers\\API\\AlbumController::index',
  'App\\Http\\Controllers\\API\\AlbumController::store',
  'App\\Http\\Controllers\\API\\AlbumController::show',
  'App\\Http\\Controllers\\API\\AlbumController::update',
  'App\\Http\\Controllers\\API\\AlbumController::destroy',
  'App\\Http\\Controllers\\API\\AlbumSongController::index',
  'App\\Http\\Controllers\\API\\AlbumSongController::store',
  'App\\Http\\Controllers\\API\\AlbumSongController::show',
  'App\\Http\\Controllers\\API\\SongController::recentlyPlayed',
  'App\\Http\\Controllers\\API\\SongController::rate',
  'App\\Http\\Controllers\\API\\PlaylistController::songs',
  'App\\Http\\Controllers\\API\\UserController::index',
  'App\\Http\\Controllers\\API\\UserController::store',
  'App\\Http\\Controllers\\API\\RadioStationController::index',
  'App\\Http\\Controllers\\IndexController::__invoke',
  'App\\Http\\Controllers\\StatusController::show',
  'App\\Http\\Controllers\\ShelfController::index',
  'App\\Http\\Controllers\\ShelfController::store',
  'App\\Http\\Controllers\\Auth\\LoginController::login',
  'App\\Http\\Controllers\\Auth\\LoginController::logout',
  'App\\Http\\Controllers\\MissingController::__invoke',
];

describe('Laravel fixture app — complete route inventory behind the SourceIndexer seam', () => {
  it('enumerates every declared route with line-anchored, contract-valid evidence', async () => {
    const repo = await makeRepository(undefined, {}, FIXTURE);
    const adapter = new SourceUaAdapter();
    const first = await adapter.collect(repo.request);
    const second = await adapter.collect(repo.request);

    const sourceRefs = first.events.flatMap((event) =>
      'ref' in event && event.ref.kind === 'source' ? [event.ref] : [],
    );
    const routeIds = sourceRefs
      .map((ref) => ref.ruleId ?? '')
      .filter((ruleId) => ruleId.startsWith('route:'))
      .map((ruleId) => ruleId.slice('route:'.length));
    const handlerIds = sourceRefs
      .map((ref) => ref.ruleId ?? '')
      .filter((ruleId) => ruleId.startsWith('handler:'))
      .map((ruleId) => ruleId.slice('handler:'.length));

    expect(routeIds.sort()).toEqual([...EXPECTED_ROUTES].sort());
    expect(handlerIds.sort()).toEqual([...EXPECTED_HANDLERS].sort());

    // Inventory-gap advisories: none — every controller and method in the
    // fixture exists. (Non-code files like composer.json still emit the
    // pre-existing unsupported-language diagnostics; that is not a gap.)
    const gapCodes = [
      'ARXIC-SOURCE-ROUTE-DYNAMIC-REGISTRATION',
      'ARXIC-SOURCE-HANDLER-UNRESOLVED',
      'ARXIC-SOURCE-PARSE-ERROR',
    ];
    expect(
      first.events.filter(
        (event) => 'diagnostic' in event && gapCodes.includes(event.diagnostic.code),
      ),
    ).toEqual([]);

    // Every route/handler ref anchors inside its file with the right blob sha.
    for (const ref of sourceRefs.filter((ref) => ref.ruleId?.startsWith('route:'))) {
      expect(ref.path).toMatch(/^routes\/(api|web)\.php$/u);
      expect(ref.startLine).toBeGreaterThanOrEqual(1);
      expect(ref.startLine).toBeLessThanOrEqual(ref.endLine);
      expect(ref.extractor).toBe('source-ua-adapter/laravel-route-inventory@1');
      expect(validateEvidenceRef(ref)).toMatchObject({ ok: true });
    }
    for (const ref of sourceRefs.filter((ref) => ref.ruleId?.startsWith('handler:'))) {
      expect(ref.path).toMatch(/^app\/Http\/Controllers\/.*\.php$/u);
      const bytes = await readFile(join(repo.root, ref.path));
      expect(ref.blobSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(validateEvidenceRef(ref)).toMatchObject({ ok: true });
    }

    // PHP files are indexed as php (language surface re-exposed).
    const phpFiles = first.manifest.filter((file) => file.language === 'php');
    expect(phpFiles.length).toBe(17);
    expect(phpFiles.every((file) => file.status === 'indexed')).toBe(true);
    expect(first.manifest.some((file) => file.path === 'composer.json')).toBe(true);

    // Deterministic: repeat run is byte-stable modulo the timestamp.
    expect(preTimestamp(first)).toBe(preTimestamp(second));
  });

  it('keeps php symbols and imports in the evidence graph (upstream surface reuse)', async () => {
    const repo = await makeRepository(undefined, {}, FIXTURE);
    const adapter = new SourceUaAdapter();
    const document = await adapter.collect(repo.request);
    const sourceRefs = document.events.flatMap((event) =>
      'ref' in event && event.ref.kind === 'source' ? [event.ref] : [],
    );
    expect(
      sourceRefs.some(
        (ref) => ref.ruleId === 'symbol:index' && ref.path.endsWith('SongController.php'),
      ),
    ).toBe(true);
    expect(
      sourceRefs.some((ref) => ref.ruleId === 'import:Illuminate\\Support\\Facades\\Route'),
    ).toBe(true);
    expect(sourceRefs.some((ref) => ref.extractor.startsWith('tree-sitter-php@'))).toBe(true);
    for (const event of document.events) {
      const validation =
        'ref' in event ? validateEvidenceRef(event.ref) : validateDiagnostic(event.diagnostic);
      expect(validation).toMatchObject({ ok: true });
    }
  });
});
