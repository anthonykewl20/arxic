# DG-02 Spike Report — Domain Inventory: the complete deterministic denominator

| Field   | Value                                                                                                                                               |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issue   | #246 (DG-02), milestone ALL-Domain Business Intent Extraction                                                                                       |
| Package | `packages/domain-inventory-spike` (`@arxic/domain-inventory-spike`)                                                                                 |
| Status  | **Provisional** — pending consensus (`consensus-terra`) and/or cross-review (`reviewer-deepseek` + `reviewer-hy3`/`codex-reviewer`) per ADR-008 §11 |
| Feeds   | ADR-008 Decision 2 (do **not** treat this report as an ADR edit); DG-05 (#249), DG-06 (#250)                                                        |
| Date    | 2026-08-16                                                                                                                                          |

**Research protocol compliance.** Code is the source of truth: Arxic shapes
were read from the adapters' actual source (cited file/line); upstream behavior
was verified against `laravel/framework` at tag `v13.25.0` and `koel/koel` at
commit `dfec91ff290509c622ff7cf392fb5e506841ee2b`; design assumptions were
validated against real repositories via GitHub code search (counts below),
not synthetic examples. Every load-bearing claim carries a citation.

---

## 1. What was built

A deterministic fusion that consumes — **read-only, unmodified** — the two
existing adapters' real output shapes, plus a documented INTERCHANGE format for
the PHP side, and produces one deduplicated inventory with a disposition on
every row:

```
@arxic/source-ua-adapter.collect()      (NormalizedSourceIndex; Tree-sitter)
        │  route: events, manifest gaps, scan diagnostics
        ▼
INTERCHANGE v1  ◄── stand-in routes-file scanner (PHP; marked standIn:true)
        │  routes + gaps, line-anchored
        ▼
   buildInventory()  ──►  rows[key] ──► clusterInventory() ──► DomainInventory
        ▲
        │  SurfaceMap (routes/forms/links/navigationEdges/diagnostics)
@arxic/crawlee-adapter.collect()        (real Playwright/Chromium crawl)
```

No LLM anywhere in the denominator. Determinism: codepoint ordering
(`localeCompare` is ICU-dependent and is deliberately not used), canonical
serialization strips volatile runtime fields (`runId`, `timestamp`,
`browserVersion`, `appBuildDigest`, `generatedAt`) — proven byte-stable across
rebuilds from identical inputs (`completeness.test.ts`, `real-world.test.ts`).

## 2. Inventory row schema (the ADR-008 §1 ledger denominator)

`InventoryRow` (`src/types.ts`):

| Field                                           | Semantics                                                                                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`                                           | The canonical fusion key `"{METHOD} {normalized-path}"`; structurally unique — `validateInventory` rejects duplicates (dedupe is not advisory). |
| `surfaceKind`                                   | `page` (GET-servable UI), `endpoint` (non-GET API/mutation target), `unknown` (mass-accounting gap rows).                                       |
| `method` + `path`                               | Normalized path uses `:param` / optional `:param?` placeholders. Runtime-only rows keep their concrete path (`/users/42`).                      |
| `origin`                                        | `source` \| `runtime` \| `both` — provenance of the fused row.                                                                                  |
| `sourceRefs`                                    | Line-anchored `EvidenceRefSource[]` (ADR-006/ADR-002 shapes). **Mandatory non-empty for `extracted`** (grounding gate, ADR-008 Decision 6).     |
| `runtimeRefs` / `runtimeUrls` / `observedForms` | Runtime observations; canonical serialization keeps only stable facts (URL, form shape).                                                        |
| `disposition`                                   | Exactly one of `extracted` / `unsupported` / `unsafe` / `unextracted-with-reason` (the binding enum, issue #246).                               |
| `reason`                                        | **Required non-empty for every non-extracted row** — the no-silent-drop rule, enforced fail-closed.                                             |
| `domain` + `verbs`                              | Deterministic cluster label + derived verbs (§5).                                                                                               |
| `conditional`                                   | Route registered inside a runtime-evaluated `if`/loop (Laravel reality — §7.3).                                                                 |
| `count`                                         | Aggregated file-mass for gap rows.                                                                                                              |

### 2.1 Path algebra (the part everything hinges on)

Upstream parameter syntaxes normalized to one canonical form
(`src/normalize-path.ts`):

| Upstream                                                                                                                                          | Normalized           |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Next.js App Router `[id]` (official docs, v16.3.1: <https://nextjs.org/docs/app/getting-started/layouts-and-pages>, "Creating a dynamic segment") | `:param`             |
| Laravel `{id}` and optional `{id?}` (`route:list` URI shape — §4)                                                                                 | `:param` / `:param?` |
| Express `:id` (<https://expressjs.com/en/guide/routing.html>, "Route parameters")                                                                 | `:param`             |

Query/hash stripping is **segment-aware**: a `?` inside a parameter token
(`{genre?}`, `:id?`) is path, not query — this exact distinction is exercised by
`GET /api/genres/{genre?}/songs` in koel (`routes/api.base.php` L236-239 @
dfec91f).

Runtime matching (`matchRuntimePath`) is segment-wise with backtracking for
optional params: a concrete runtime value (`/api/albums/42/songs`) fuses to a
parameterized source route (`/api/albums/:param/songs`); the least-parameterized
candidate wins (deterministic tie-break). **Why this matters**: without it,
source/runtime dedupe fails on every parameterized route — i.e. on most of a
real API surface (koel: 116 of 188 routes carry `{param}` segments).

## 3. Disposition semantics (deterministic rules)

| Disposition               | Assigned when                                                                                                                                                                                                                                                                                                                                      | Truth-state analogue                                                                                                                                                                                                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extracted`               | Row is grounded by ≥1 line-anchored source EvidenceRef (TS/JS pack or interchange). Fused rows stay `extracted`.                                                                                                                                                                                                                                   | `hypothesized`+grounded (source) / `observed` (when fused with runtime)                                                                                                                                                                                                                                                             |
| `unsupported`             | Surface **mass** known to exist but produced by a language no installed pack covers: aggregated per-language gap row from the source manifest (`category:'code'`, extension-derived language, file count). This is the campaign's 1,128-PHP-files case made visible in the denominator instead of vanishing into diagnostics.                      | `blocked`                                                                                                                                                                                                                                                                                                                           |
| `unsafe`                  | Runtime-observed mutation surface with **no source grounding**: destructive form (`method != GET`) observed but never submitted under the crawl's default-deny mutation policy (`ARXIC-SURFACE-FORM_SUBMIT_BLOCKED`-class facts, `packages/crawlee-adapter/src/adapter.ts` L192-201 destructive-form observation, L334-347 non-safe-method abort). | `blocked`                                                                                                                                                                                                                                                                                                                           |
| `unextracted-with-reason` | Everything else that exists in an input but yielded no grounded extraction: runtime-only pages (`no-source-match`), frontier-bound links (`crawl-frontier-bound:max-depth                                                                                                                                                                          | max-urls`; external-origin edges are **out-of-target** and excluded by policy), per-file `parse-error` rows, interchange gaps (`dynamic-registration`, `unresolved-file`, …), source-scan diagnostics (`source-scan-diagnostic:<code>`), invalid interchanges (`interchange-invalid:…` — rejected fail-closed but still accounted). | `blocked` |

**Completeness invariant (binding acceptance):** `rows.length ==
sum(dispositions) == stats.totalRows`, with `stats` verified by an **independent
recount** in `validateInventory` (not derived from the builder's own numbers —
anti-tautology, charter §3). Proven across all suites; corruption tests prove
the validator fires (`ARXIC-INVENTORY-COMPLETENESS`, `ARXIC-INVENTORY-ROW-INVALID`).

**Dedupe/fusion keys (summary):** primary key `METHOD + normalized path`;
runtime fusion via parameterized matching; form facts merge onto matched
endpoint rows (`observedForms`), otherwise spawn `unsafe` endpoint rows;
frontier edges spawn page rows only for same-origin targets not otherwise
present. Measured dedupe: reference app 3 merged (7 source events + 3 runtime
surfaces → 10 rows), vulnerable app 4 merged (8 + 1 → 9).

## 4. The INTERCHANGE format v1 (PHP side, DG-01/DG-05 hand-off)

`src/interchange.ts`. **Design anchor:** Laravel's own
`artisan route:list --json` per-route shape —
`{ method: "GET|HEAD", uri, name, action, middleware: [] }` — from
`laravel/framework` `src/Illuminate/Foundation/Console/RouteListCommand.php` at
tag **v13.25.0**, `getRouteInformation()` L151-159 and `asJson()` L385-390
(<https://github.com/laravel/framework/blob/v13.25.0/src/Illuminate/Foundation/Console/RouteListCommand.php>).
The interchange is a strict superset:

- `methods: HttpMethod[]` (accepts the route:list pipe string `method:
"GET|HEAD"` on input for direct pack adoption — tested);
- per-route **line anchors** (`sourcePath`, `startLine`, `endLine`) — the thing
  `route:list` lacks and ADR-008 Decision 6 requires;
- per-file `sha256` map + header `provenance {repository, commit}` → every
  route becomes a full `EvidenceRefSource` at fusion time;
- `conditional: true` for routes registered inside runtime-evaluated blocks;
- `gaps[]` with kinds `dynamic-registration | parse-error | unresolved-file |
conditional-block | unsupported` — a producer that **cannot** enumerate
  something says so instead of omitting it;
- `standIn: boolean` mandatory — the DG-02 producer is forced to mark itself
  (`arxic-langpack-php-standin@0.1.0`), and a non-stand-in pack must carry a
  versioned `packId` (`name@version`, validated).

Validation is fail-closed (wrong schemaVersion, missing uri, bad method tokens,
reversed line anchors, unknown gap kinds, malformed provenance → rejected with
`ARXIC-INVENTORY-INTERCHANGE-INVALID`); a rejected interchange still enters the
denominator as an `unextracted-with-reason` gap row — rejection never drops the
mass.

**Frozen JSON Schema in `schemas/` is deliberately deferred** to DG-05 (a new
frozen contract needs its own process per AGENTS/ADR §10); this spike ships the
documented TS shape + validator + tests as the spec.

### 4.1 The stand-in enumerator (`src/standin-php.ts`) — explicitly a stand-in

Static scan of `routes/**/*.php` (any file name — justified by §7.1) handling,
with line anchors: verb routes (closure / invokable-controller /
`[Controller::class,'method']` actions), `Route::match`, nested
`Route::prefix()->…->group()` and `Route::group(['prefix'=>…])` composition
(prefix leak from nested groups is specifically guarded — see §7.2),
`apiResource`/`resource` expansion (5/7 standard actions; dotted nested
resources `albums.songs` → `/api/albums/{album}/songs[/{song}]`;
`->except()/->only()`), `->name()/->middleware()` chains, optional `{param?}`,
routes inside `if`/`foreach` bodies flagged `conditional`, and — critically —
**non-fabrication**: interpolated URIs (koel's subsonic
`"{$endpoint}{format?}"`) become `dynamic-registration` gaps, never invented
routes. Unresolvable `Route::` statements become per-file `parse-error` gaps.

## 5. Deterministic domain clustering

`src/cluster.ts`. **No LLM.**

- **Domain label** = first static (non-param) path segment after dropping `api`
  and `vN` prefixes, singularized by deterministic English rules (irregulars
  table; `ies→y`; `ses/xes/ches/shes→-2`; `s→∅`). `/` → `root`; symbolic gap
  paths → `uncategorized`. Every row is clustered exactly once (tested).
- **Verbs** = CRUD derivation from method × parameterization (`GET`
  collection → `read-list`, `GET` with `:param` → `read-one`, `POST`→`create`,
  `PUT`/`PATCH`→`update`, `DELETE`→`delete`), overridden by a fixed, documented
  action-segment lexicon (`login`, `logout`, `search`, `upload`, `export`,
  `reset`, `verify`, `approve`, … — `ACTION_LEXICON` in source). The lexicon is
  additive data, not domain-literal branching in pipeline code (ADR-008
  Decision 3 concern); adding entries never changes control flow.

### 5.1 Clustering quality assessment (honest)

- koel (188 routes → **19 domains**): resource clusters are excellent —
  `album(…), song(…), playlist(…), playlist-folder(…), artist(…), genre(…),
user(…), podcast(…), invitation(…)` match the app's real bounded contexts.
  Weak spots: action-y segments become their own domains (`forgot-password`,
  `auth` for SSO callbacks — defensible), and `me` aggregates the profile
  endpoints (REST-honest but user-facing it is "profile").
- Fixture apps: `login/logout/forgot/reset/mfa` clusters are semantically right
  without any auth-specific code — the nouns came from the paths.
- **Known weaknesses (dissent, recorded):** (a) hyphenated compounds stay
  verbatim (`playlist-folder` fine, `forgot-password` noisy); (b) one endpoint
  serving two journeys lands in one cluster — ADR-008's acknowledged risk; the
  ledger always exposes raw rows, so a weak grouping cannot hide the
  denominator; (c) English-only singularization. All acceptable for a
  deterministic v1; the report explicitly does NOT claim clustering is
  production-ready — it claims it is deterministic, inspectable, and honest.

## 6. Measurement results

### 6.1 Real fixture apps (end-to-end: real Tree-sitter + real Chromium crawl)

`src/__tests__/real-world.test.ts` (runs in CI); artifacts
`docs/evidence/DG-02/{reference,vulnerable}-auth-app-inventory.json`.

|                                                | reference-auth-app (Next.js 15)                                                            | vulnerable-auth-app (Express)                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Crawl (real Chromium, maxUrls 12 / maxDepth 2) | `/`, `/login`, `/forgot-password`                                                          | `/`                                                                            |
| **Total rows**                                 | **10**                                                                                     | **9**                                                                          |
| extracted                                      | 7                                                                                          | 8                                                                              |
| unsupported                                    | 0                                                                                          | 0                                                                              |
| unsafe                                         | **2** (`POST /login`, `POST /forgot-password`)                                             | 0                                                                              |
| unextracted-with-reason                        | 1 (scan diagnostic)                                                                        | 1 (scan diagnostic)                                                            |
| origin both (fused)                            | 3 (`GET /`, `GET /login`, `GET /forgot-password`)                                          | 5 (GET / + all four POST endpoints)                                            |
| Dedupe                                         | 7 source events + 3 runtime surfaces + 2 forms → 10 rows                                   | 8 + 1 + 4 → 9 rows                                                             |
| Domains                                        | login(2), mfa(2), forgot-password(2), change-password, reset-password, root, uncategorized | login, logout, forgot, reset, root, `__arxic`(2), `.well-known`, uncategorized |

The two `unsafe` rows on the Next.js app are the spike's sharpest finding: the
login/forgot **server-action forms** POST to the page URL, and the current
`source-ua-adapter` extracts only page-file conventions + Express-style
`app.METHOD` calls (`packages/source-ua-adapter/src/framework-registry.ts`
L18-53) — **Next.js `route.ts` API handlers and server-action mutations are
invisible to source enumeration today**. The disposition makes that gap a
first-class row instead of a silent absence. This is concrete DG-01 scope: the
TS pack needs `app/**/route.ts` and server-action inventory rules. (The
fixture's `/logout`, `/api/__arxic/*` route handlers are likewise absent from
source rows — same root cause.)

### 6.2 Real third-party Laravel app (source side)

**Campaign monorepo substitution (documented, per issue protocol):** the
campaign's private Laravel 13 + Next.js monorepo is not locatable
(`/home/soultransit/devtony/arxic-private/` holds only the internal ADR and
gear clones; #257–#259 have no location pointer). Substituted:
**koel/koel @ `dfec91ff290509c622ff7cf392fb5e506841ee2b`** (MIT, 17.2k stars) —
a real production Laravel app whose `composer.json` requires
`laravel/framework: ^13.0` and whose `composer.lock` pins **v13.24.0** (both
read from the clone, not memory) — the same framework major as the campaign
backend. Cloned `--depth 1` to `/tmp/opencode/koel` (outside the repo).

|                               | koel/koel (stand-in PHP side, source only)                                                                                                                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route statements in `routes/` | 147 `Route::` occurrences across 5 files                                                                                                                                                                                                                                     |
| **Enumerated routes**         | **188** (after `apiResource` expansion; 116 carry `{param}`)                                                                                                                                                                                                                 |
| Gaps                          | 1 `dynamic-registration` (`routes/subsonic.php` — ~48 loop-registered endpoints recorded as a gap, not faked)                                                                                                                                                                |
| Conditional routes            | 7 (`if (config('koel.download.allow'))` download block, `if (ITunes::used())`, version-aware blocks)                                                                                                                                                                         |
| **Inventory**                 | **189 rows**: 188 extracted + 1 unextracted-with-reason; 19 clusters; validation PASS                                                                                                                                                                                        |
| Known misses                  | `/up` health route (registered in `bootstrap/app.php` `withRouting(health:)`, outside `routes/`); header-versioned `routes/{web,api}.<version>.php` overlays (mechanism exists — `RouteServiceProvider::loadVersionAwareRoutes` — but no version files exist at this commit) |

Ground-truth caveat (honest limit): no PHP runtime on this host, so the 188
could not be diffed against `artisan route:list --json` — the number is
statement-level complete (every `Route::` occurrence accounted as route or
gap) but not runtime-verified. DG-01 should treat `route:list` as its oracle
where bootable. Spot-verified against source by hand: 25/25 route probes
(method+URI) match the repository text at the pinned commit.

### 6.3 Dedupe/fusion stats summary

Fusion deduplicated every cross-source collision: no duplicate keys survived
(`validateInventory` enforces uniqueness); matched runtime surfaces raised
`origin` to `both` and merged evidence; destructive forms either merged onto
grounded endpoint rows (Express) or spawned explicit `unsafe` rows (Next.js
server actions).

## 7. Real-world diversity findings (the research yield)

### 7.1 Route-file discovery cannot assume conventions

koel's route files are `routes/web.base.php`, `routes/api.base.php`,
`routes/subsonic.php` — wired via
`RouteServiceProvider::loadVersionAwareRoutes()` and
`Route::middleware('api')->group(base_path('routes/subsonic.php'))` inside
`bootstrap/app.php`'s `withRouting(using: …)` (all @ dfec91f:
`bootstrap/app.php`, `app/Providers/RouteServiceProvider.php`). Version-aware
loading even varies the route set **by request header** (`X-Api-Version`).
Scale evidence (GitHub code search, 2026-08-16): **62,976** `bootstrap/app.php`
files use `withRouting`; **98,560** route files use `Route::prefix`;
**136,448** use `Route::resource`; **26,880** use `apiResource`. **DG-01 pack
requirement:** route-file discovery must follow bootstrap wiring (and/or run
`route:list`), never assume `routes/web.php` + `routes/api.php`.

### 7.2 Nested prefix composition is load-bearing — and subtle

A real bug found during measurement: an outer
`Route::middleware('auth')->group(closure)` with no own prefix must not inherit
a _nested_ `Route::group(['prefix' => 'radio'], …)`'s prefix — the naive "scan
group args for a prefix key" leak made 156 of koel's routes
`/api/radio/…`-shaped until fixed (prefix extraction now cut to the leading,
pre-closure argument). Any DG-05 static enumerator will hit this class.

### 7.3 Conditional + dynamic registration is normal, not exceptional

koel registers routes inside `if (config(...))` / `if (ITunes::used())`
(`routes/web.base.php` L25-47 @ dfec91f) and builds ~48 Subsonic endpoints from
a data table in a `foreach` with interpolated URIs (`routes/subsonic.php`
L113-117). A deterministic denominator must flag (`conditional`) or gap
(`dynamic-registration`) these rather than fabricate or drop — both disposition
paths are exercised by tests.

### 7.4 TS-side enumerator gaps are disposition-visible

Next.js `route.ts` handlers + server-action forms (§6.1) — the reference
fixture measures the gap precisely (2 `unsafe` rows + absent `/logout` /
`/api/__arxic/*` source rows).

### 7.5 Runtime crawl boundaries become rows, not silence

Frontier stops (`max-depth`/`max-urls`) on same-origin targets produce
`crawl-frontier-bound:*` rows; external-origin edges are excluded as
out-of-target (target-scope policy, `packages/crawlee-adapter/src/adapter.ts`
L226-244).

## 8. What this spike deliberately did NOT do

- No pipeline-stage integration (DG-06 #250), no evidence-graph fusion, no
  `arxic intents` command, no edits to ADR-008/SYNC/CHANGELOG/VERSION (charter
  §10.2 — slice note carries the doc updates).
- No runtime crawl of koel: needs a bootable third-party Laravel target with
  attestation + seeded DB — out of spike scope; the runtime side is proven on
  the two fixture apps in real Chromium. Documented as the measurement's
  boundary, not hidden.
- No PHP parsing beyond the stand-in scanner (no tree-sitter-php): DG-01 owns
  the real pack; this spike's PHP code never leaves `packages/domain-inventory-spike`.
- No frozen JSON Schema for the interchange (deferred to DG-05 with its own
  contract process).
- No LLM/ModelAdapter anywhere.

## 9. Provisional conclusions (pending cross-review)

1. **The completeness-by-construction denominator works end-to-end on real
   apps**: three real targets measured; the invariant held everywhere; every
   non-extracted mass is explicit, including the campaign-shaped
   unsupported-language case (unit-proven with PHP files, fusion.test.ts).
2. **The interchange format is adoptable by a real pack**: anchored on
   Laravel's own `route:list --json` (v13.25.0) with line anchors + gaps added;
   the stand-in demonstrated every koel-observed route shape except loop-built
   URIs, which the gap kind exists for.
3. **Fusion keys need parameterized normalization** or dedupe fails on most of
   a real API (116/188 koel routes are parameterized).
4. **Dispositions surfaced real, quantified enumerator gaps** (Next.js
   route.ts/server actions; bootstrap-registered `/up`) — the enum is doing
   product work, not bookkeeping.
5. **Deterministic clustering is good enough to feed DG-04 prioritization**
   (resource clusters match koel's real domains) and honest about its limits.

**Dissent to record for reviewers:** (a) `unsafe` currently conflates "we
refused to submit the form" with "no source grounding" — arguably a grounded
destructive endpoint should also carry a replay-safety flag; the row records
`observedForms` so DG-06 can split this without schema breakage. (b) The
`unsupported` disposition aggregates per language, not per file — right for
1,128-file campaigns, possibly too coarse for tens of files; count field keeps
it auditable. (c) GitHub code-search counts are point-in-time and
query-sensitive; they establish order-of-magnitude prevalence only.

## 10. Reproduce

```bash
pnpm vitest run packages/domain-inventory-spike   # 70 tests incl. real Chromium crawl
pnpm typecheck && pnpm lint && pnpm format:check
```

Offline koel reproduction: `docs/evidence/DG-02/README.md`.
