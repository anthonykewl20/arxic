import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// The REAL DG-02 validator — the interchange is the Domain Inventory's
// documented input contract (issue #246 deliverable 1); DG-05 owns the
// translator and must prove conformance against the real consumer-side
// validator, not a local re-implementation (contract note on #249).
import {
  INTERCHANGE_SCHEMA_VERSION,
  validateInterchange,
} from '../../../domain-inventory-spike/src/interchange';
import { SourceUaAdapter } from '../index';
import { makeRepository } from './test-repo';

// End-to-end: real tree-sitter-php engine → language pack → interchange →
// the real validateInterchange accepts; corrupted documents are rejected
// fail-closed with ARXIC-INVENTORY-INTERCHANGE-INVALID.

const FIXTURE = resolve(import.meta.dirname, 'fixtures/laravel-app');

describe('Language pack → RouteInventoryInterchange translator (DG-05 contract)', () => {
  it('emits one valid interchange per route-producing pack, accepted by the real DG-02 validator', async () => {
    const repo = await makeRepository(undefined, {}, FIXTURE);
    const adapter = new SourceUaAdapter();
    const inventories = await adapter.collectRouteInventories(repo.request);

    expect(inventories).toHaveLength(1);
    const interchange = inventories[0] as unknown;
    const validation = validateInterchange(interchange);
    expect(validation).toMatchObject({ ok: true });
    if (!validation.ok) return;

    const value = validation.value;
    expect(value.schemaVersion).toBe(INTERCHANGE_SCHEMA_VERSION);
    expect(value.packId).toBe('arxic-langpack-php@1.0.0');
    expect(value.language).toBe('php');
    expect(value.framework).toBe('laravel');
    // A real pack is never a stand-in (no unmarked stand-ins — DG-02 rule).
    expect(value.standIn).toBe(false);
    expect(value.provenance).toEqual({
      repository: repo.request.revision.repository,
      commit: repo.request.revision.commit,
    });
  });

  it('carries every fixture route with anchors, actions, middleware, and conditional marking', async () => {
    const repo = await makeRepository(undefined, {}, FIXTURE);
    const [interchange] = await new SourceUaAdapter().collectRouteInventories(repo.request);
    const validation = validateInterchange(interchange);
    expect(validation).toMatchObject({ ok: true });
    if (!validation.ok) return;
    const { routes, gaps } = validation.value;

    const keys = routes.map((route) => `${route.methods.join('|')} ${route.uri}`);
    // Spot probes across every rule layer (verb/group/prefix/apiResource/
    // nested-dot resource/match/foreach-resolved/redirect/view/fallback/any).
    expect(keys).toEqual(
      expect.arrayContaining([
        'GET|POST /api/echo',
        'POST /api/me',
        'GET /api/albums/{album}/songs/{song}',
        'GET /rest/health{format?}',
        'GET /legacy',
        'GET /about',
        'GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS /',
      ]),
    );

    // Array controller action uses the route:list Controller@method form.
    const rating = routes.find((route) => route.uri === '/api/songs/{song}/rating');
    expect(rating).toMatchObject({
      action: 'App\\Http\\Controllers\\API\\SongController@rate',
      sourcePath: 'routes/api.php',
      startLine: expect.any(Number),
      endLine: expect.any(Number),
    });

    // Invokable controllers use the bare-controller form (stand-in convention).
    const login = routes.find((route) => route.uri === '/api/me' && route.methods.includes('POST'));
    expect(login?.action).toBe('App\\Http\\Controllers\\API\\LoginController');

    // Group + route middleware compose in declaration order.
    expect(rating?.middleware).toEqual(['api', 'auth']);

    // Routes inside an if-block are marked conditional — never unconditional.
    const users = routes.filter((route) => route.uri === '/api/users');
    expect(users).toHaveLength(2);
    expect(users.every((route) => route.conditional === true)).toBe(true);
    const plain = routes.find((route) => route.uri === '/api/ping');
    expect(plain?.conditional).toBeUndefined();

    // The fixture resolves fully: zero gaps (fail-closed accounting shows none).
    expect(gaps).toEqual([]);

    // Every route file that produced routes is accounted with its blob sha.
    const apiEntry = validation.value.files.find((file) => file.path === 'routes/api.php');
    expect(apiEntry).toBeDefined();
    const bytes = await readFile(join(repo.root, 'routes/api.php'));
    expect(apiEntry?.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('is deterministic: repeat runs are byte-identical (modulo nothing)', async () => {
    const repo = await makeRepository(undefined, {}, FIXTURE);
    const adapter = new SourceUaAdapter();
    const first = await adapter.collectRouteInventories(repo.request);
    const second = await adapter.collectRouteInventories(repo.request);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('the real validator rejects a corrupted interchange fail-closed (ARXIC-INVENTORY-INTERCHANGE-INVALID)', async () => {
    const repo = await makeRepository(undefined, {}, FIXTURE);
    const [interchange] = await new SourceUaAdapter().collectRouteInventories(repo.request);

    // Corruption 1: silent route drop is not representable — but a route with
    // its anchors stripped must be rejected.
    const noAnchors = structuredClone(interchange);
    (noAnchors.routes[0] as Record<string, unknown>).startLine = 0;
    expect(validateInterchange(noAnchors)).toMatchObject({ ok: false });

    // Corruption 2: an unversioned/stand-in-shaped packId is rejected.
    const fakePack = structuredClone(interchange);
    (fakePack as Record<string, unknown>).packId = 'php';
    const rejected = validateInterchange(fakePack);
    expect(rejected).toMatchObject({ ok: false });
    if (rejected.ok) return;
    expect(rejected.diagnostics[0]?.code).toBe('ARXIC-INVENTORY-INTERCHANGE-INVALID');

    // Corruption 3: gaps must never be silently emptied past validation — a
    // dropped gaps array is a shape violation.
    const noGaps = structuredClone(interchange);
    delete (noGaps as Record<string, unknown>).gaps;
    expect(validateInterchange(noGaps)).toMatchObject({ ok: false });
  });

  it('maps never-silent advisory classes to interchange gap kinds with line anchors', async () => {
    // A route file with an unresolvable interpolated URI inside an if-block:
    // the interchange must carry a dynamic-registration gap naming the file.
    const repo = await makeRepository(undefined, {
      'composer.json': JSON.stringify({
        name: 'acme/dyn',
        autoload: { 'psr-4': { 'App\\': 'app/' } },
      }),
      'routes/api.php': `<?php

use Illuminate\\Support\\Facades\\Route;

if (app()->bound('feature')) {
    Route::get("{$prefix}/ping", static fn () => null);
}
`,
    });
    const [interchange] = await new SourceUaAdapter().collectRouteInventories(repo.request);
    const validation = validateInterchange(interchange);
    expect(validation).toMatchObject({ ok: true });
    if (!validation.ok) return;
    expect(validation.value.routes).toEqual([]);
    expect(validation.value.gaps).toHaveLength(1);
    const gap = validation.value.gaps[0]!;
    expect(gap.kind).toBe('dynamic-registration');
    expect(gap.sourcePath).toBe('routes/api.php');
    expect(gap.startLine).toBeGreaterThanOrEqual(1);
    expect(gap.reason.length).toBeGreaterThan(0);
  });
});
