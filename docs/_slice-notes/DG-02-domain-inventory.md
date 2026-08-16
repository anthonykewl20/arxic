# DG-02-domain-inventory — staged doc updates (charter §10.2)

Issue: #246 · PR: #264 · Disposition: mixed (denominator verified on real apps in CI; spike conclusions provisional pending cross-review)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #246 | [DG-02] Research spike: Domain Inventory — complete deterministic denominator | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-16 (5) | **#246 (DG-02) Domain Inventory spike DONE.** New `packages/domain-inventory-spike` fuses the REAL `source-ua-adapter` NormalizedSourceIndex + REAL `crawlee-adapter` SurfaceMap (both consumed read-only) + a documented PHP route-inventory INTERCHANGE v1 (anchored on Laravel `route:list --json` @ v13.25.0, with line anchors + gaps) produced by an explicitly-marked stand-in routes-file scanner. Deterministic resource/noun+verb clustering, no LLM anywhere. Disposition enum on every row (extracted/unsupported/unsafe/unextracted-with-reason) with a proven completeness invariant (independent recount, fail-closed validation, ARXIC-INVENTORY-* diagnostics). Measured: reference-auth-app 10 rows (7/0/2/1 — the two `unsafe` rows quantify the Next.js server-action/route.ts source-enumeration gap), vulnerable-auth-app 9 rows (8/0/0/1, all four POST endpoints fused source+runtime), koel/koel @ dfec91f (Laravel 13.24 per composer.lock — documented substitution for the unlocatable campaign monorepo) 189 rows / 188 extracted / 19 clusters. Real-world proof: real Tree-sitter + real Chromium crawl of both fixture apps in CI (`real-world.test.ts`); koel artifact committed under `docs/evidence/DG-02/`. Spike report `docs/spikes/dg-02-domain-inventory.md` (citations incl. GitHub code-search prevalence: 62,976 bootstrap `withRouting`, 136,448 `Route::resource`). Conclusions provisional pending consensus/cross-review per ADR-008 §11. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### internal`

```
- DG-02 domain inventory spike (#246): `@arxic/domain-inventory-spike` — deterministic fusion of source route/page/endpoint enumeration (source-ua-adapter output + documented PHP INTERCHANGE v1 fed by a stand-in routes-file scanner) with the runtime crawl SurfaceMap into one deduplicated denominator; disposition enum on every row with a proven completeness invariant; deterministic resource/noun+verb clustering; measured on both fixture apps (real Chromium) and koel/koel@dfec91f (real Laravel 13 app, documented substitution).
```

## 4. `VERSION` bump required?

no — research spike, no user-observable capability ships (new private workspace package + docs only)

## 5. Evidence pointers

- Real-world proof: `packages/domain-inventory-spike/src/__tests__/real-world.test.ts` — real Tree-sitter (`SourceUaAdapter.collect`) + real Playwright/Chromium (`CrawleeSurfaceDiscoverer.collect`) against BOTH fixture apps, ephemeral ports + per-run temp sqlite (§10 rules)
- Real-repo data: `src/__tests__/koel-interchange.test.ts` + `docs/evidence/DG-02/` (koel/koel @ dfec91ff provenance in its README)
- Spike report: `docs/spikes/dg-02-domain-inventory.md`
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (70 package tests; full repo `pnpm test` green) ☑ · license gate ☑ (no new external deps — workspace deps only)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                                                                 | Expected disposition                                                                             | Test                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Interchange with wrong schemaVersion / missing uri / bad method / reversed anchors / unknown gap kind / unversioned non-stand-in packId | rejected fail-closed (`blocked`-shaped diagnostics) + accounted as `interchange-invalid` gap row | `sad-paths.test.ts`, `interchange` describe block                          |
| Row with disposition outside the enum                                                                                                   | validation fails `ARXIC-INVENTORY-ROW-INVALID`                                                   | `sad-paths.test.ts`                                                        |
| Non-extracted row with empty reason (silent drop attempt)                                                                               | validation fails                                                                                 | `sad-paths.test.ts`                                                        |
| Stats disagree with rows (completeness corruption)                                                                                      | validation fails `ARXIC-INVENTORY-COMPLETNESS`                                                   | `sad-paths.test.ts`                                                        |
| Duplicate fusion keys                                                                                                                   | validation fails (dedupe is structural)                                                          | `sad-paths.test.ts`                                                        |
| `extracted` row with zero source refs (fabrication attempt)                                                                             | validation fails (grounding gate)                                                                | `sad-paths.test.ts`                                                        |
| Source scan that only produced diagnostics                                                                                              | gap row preserved, inventory stays valid                                                         | `sad-paths.test.ts`                                                        |
| Empty inputs                                                                                                                            | valid honest-zero inventory                                                                      | `sad-paths.test.ts`                                                        |
| Runtime page with no source match                                                                                                       | `unextracted-with-reason` (`no-source-match`)                                                    | `fusion.test.ts`                                                           |
| Destructive form with no source route                                                                                                   | `unsafe` (`destructive-form-not-submitted`)                                                      | `fusion.test.ts`, `real-world.test.ts` (Next.js server-action POST /login) |
| Destructive form matching a source route                                                                                                | stays `extracted`, form fact recorded, origin `both`                                             | `fusion.test.ts`, `real-world.test.ts` (Express POST /login)               |
| External-origin navigation edge                                                                                                         | out-of-target: NO row (policy)                                                                   | `fusion.test.ts`                                                           |
| Frontier-blocked same-origin link                                                                                                       | `unextracted-with-reason` (`crawl-frontier-bound:*`)                                             | `fusion.test.ts`                                                           |
| Unsupported-language code files (campaign shape)                                                                                        | one aggregated `unsupported` row per language, code-category only                                | `fusion.test.ts`                                                           |
| Parse-error source file                                                                                                                 | per-file `unextracted-with-reason` row                                                           | `fusion.test.ts`                                                           |
| Interpolated loop-driven Laravel URI                                                                                                    | `dynamic-registration` gap, never a fabricated route                                             | `standin.test.ts`                                                          |
| Unresolvable `Route::` statement / unreadable file                                                                                      | `parse-error` / `unresolved-file` gap                                                            | `standin.test.ts`                                                          |
| Relative path into normalizePath                                                                                                        | throws (absolute paths only)                                                                     | `fusion.test.ts`                                                           |
