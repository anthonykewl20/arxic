# DG-05-language-pack-impl — staged doc updates (charter §10.2)

Issue: #249 · PR: #270 · Disposition: verified

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #249 | [DG-05] Implement: Language Pack SPI + PHP pack behind SourceIndexer | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-16 | **#249 (DG-05) Language Pack SPI + PHP pack DONE.** DG-01 spike productionized behind the frozen SourceIndexer: data-driven language packs (grammar npm reference + versioned framework rules, `arxic-langpack-php@1.0.0`), DG-02 `RouteInventoryInterchange` emission via `collectRouteInventories()` with the translator integration-tested against the REAL `validateInterchange` (corrupted docs rejected fail-closed), extended never-silent accounting (conditional if-block marking, middleware threading, unknown Route:: constructs, provider/require file-include gaps incl. service-provider methods), accurate per-language diagnostics (.mts→TypeScript; `.rb`→"Language ruby…"), and the recorded 2-line apps/worker tree-sitter-php handoff. Proven on koel (Laravel 13.24.0: 239-route interchange, 0/1412 parse failures, validator ok) and BookStack (12.64.0: 335 routes, provider-include gaps surfaced) with committed evidence; full suite 156 files / 1307 tests green. **Next: #250 (DG-06).** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- DG-05 Language Pack SPI + PHP pack behind SourceIndexer (#249): data-driven language packs (grammar + versioned framework inventory rules) productionize the DG-01 prototype — PHP pack emits the DG-02 RouteInventoryInterchange (standIn: false) via `SourceUaAdapter.collectRouteInventories()`, with line anchors, conditional if-block marking, composed middleware, per-file sha256, and never-silent gap accounting (dynamic registration, unknown Route:: constructs, provider/require file includes, parse errors, grammar-unavailable runtimes); unsupported-language diagnostics now name the actual language (.mts/.cts parse as TypeScript); the worker sandbox carries the PHP grammar natively (tsup externals + dependency). Proven on real Laravel apps: koel 13.24.0 (239-route interchange, 0 parse failures) and BookStack 12.64.0 (335 routes, provider-include gaps visible), interchange validated by the real DG-02 validator.
```

## 4. VERSION bump required?

no — capability is adapter-level behind the frozen seam; no user-observable CLI/pipeline surface changes yet (DG-06 wires the Domain Inventory stage; bump then if the release train wants it observable).

## 5. Evidence pointers

- Real-world proof: `packages/source-ua-adapter/src/__tests__/koel-interchange.test.ts` (committed koel artifact re-validated in CI with the real DG-02 validator, independent recorded literals) + local-only corpus runs via `packages/source-ua-adapter/scripts/measure-laravel-inventory.mts` (koel + BookStack clones outside the repo; every emitted interchange validated `ok` before writing).
- Artifacts: `docs/evidence/DG-05/{koel,bookstack}-arxic-langpack-php-interchange.json` + summaries + README. Contract tests: `interchange.test.ts` (real validator accepts/rejects), `mixed-language.test.ts` (campaign defect fixed).
- Gates: typecheck ☑ · typecheck:packages ☑ · lint ☑ · format:check ☑ (full repo, after the note) · test 156 files / 1307 passing ☑ · license gate unchanged (no new deps; tree-sitter-php@0.23.12 already gate-green)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                                                                    | Expected disposition                                                                                                               | Test                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Interchange route with stripped anchors                                                                                                    | real validator rejects (`ARXIC-INVENTORY-INTERCHANGE-INVALID`)                                                                     | `interchange.test.ts`                              |
| Unversioned/stand-in-shaped packId in interchange                                                                                          | real validator rejects fail-closed                                                                                                 | `interchange.test.ts`                              |
| Dropped gaps array                                                                                                                         | real validator rejects (shape violation)                                                                                           | `interchange.test.ts`                              |
| Unresolvable interpolated URI                                                                                                              | dynamic-registration gap with line anchors; no fabricated row                                                                      | `interchange.test.ts` + `laravel-routes.test.ts`   |
| Unknown `Route::` registrar                                                                                                                | ARXIC-SOURCE-ROUTE-UNSUPPORTED-CONSTRUCT advisory + `unsupported` gap; documented non-route API (bind/model/pattern…) stays silent | `laravel-routes.test.ts`                           |
| `require base_path(...)` / `Route::group(..., base_path(...))` file include (incl. inside service-provider methods; dynamic-path includes) | ARXIC-SOURCE-ROUTE-FILE-INCLUDE advisory + `unresolved-file` gap naming the file                                                   | `laravel-routes.test.ts` + BookStack/koel evidence |
| Runtime without the php grammar                                                                                                            | per-file blocked ARXIC-SOURCE-GRAMMAR-UNAVAILABLE + manifest reason; boot safe                                                     | `php-surface.test.ts` (DG-01, still green)         |
| Malformed PHP file                                                                                                                         | manifest `parse-error` + interchange `parse-error` gap (Blade-as-.php on real BookStack)                                           | `php-surface.test.ts` + evidence                   |
| Mixed-language monorepo (TS+JS+PHP+`.rb`+`.py`+unknown ext)                                                                                | accurate per-file classification; `.mts` parsed as TypeScript; ruby named as ruby; unknown ext honest                              | `mixed-language.test.ts`                           |
| Policy narrowed to TS/JS                                                                                                                   | php skipped with the real language named (campaign shape)                                                                          | `php-surface.test.ts`                              |

**Deferred from DG-01 §5.4/§6 (not in #249's acceptance wording):**

- Provider-include PREFIX RESOLUTION (two-pass providers→routes composition): the include is now a visible per-file gap with the including context named, but prefixes are still not applied to included files (BookStack api rows unprefixed; 9 URI collisions vs web rows stand). Requires provider-first scanning; DG-06/#250 or a dedicated follow-up.
- `extends`-chasing for inherited controller handlers (koel: 1 known false-negative class, advisory-visible).
- foreach-product CPU cap (1 MB policy quota bounds input; local-tooling threat model).
- Frozen JSON Schema for the interchange: DG-02 §4 already defers it with its own contract process; the pack targets the TypeScript shape + real validator.

## 7. Review round (2026-08-17, independent review of PR #270 — both findings fixed in-slice)

- **P2 mirror drift:** the mirror `InterchangeGap` omitted the real contract's optional `estimatedRouteCount` — exactly the optional+unemitted field class the real validator cannot catch. Fixed by (a) adding the field to the mirror AND the engine's `LaravelGap`, (b) exercising it in emission (foreach dynamic-registration gaps now carry the loop body's `countRouteCalls` — also closing a silent hole: that gap previously reached only the advisory stream, never interchange `gaps[]`; literal file-include gaps carry a count parsed from the included file via the safe access seam), and (c) a compile-time lockstep guard: `src/__tests__/interchange-lockstep.test.ts` asserts strict type equality (`Expect<Equal<…>>`) between the mirror and the REAL DG-02 contract types (gap, route, and document) via type-only imports (erased at runtime — no dependency edge), enforced by `pnpm typecheck`/CI; the runtime half asserts an emitted `estimatedRouteCount` gap passes the real `validateInterchange`.
- **P3 arithmetic + stale number:** `docs/evidence/DG-05/README.md` now records the exact cross-tool reconciliation — 188 non-subsonic (DG-02 stand-in) + 51 subsonic (verified against `routes/subsonic.php:58-110` at koel@dfec91ff and the committed interchange) = 239 — and DG-01 §5.2 carries a dated 49 → 51 correction (304 was a slight undercount of per-method evidence rows; 239 is the registration count). Evidence artifacts regenerated: gaps gain `estimatedRouteCount` (BookStack web 260 / api 78; koel channels 0; koel dynamic include omits the field); route/gap counts and the CI artifact literals are unchanged.
