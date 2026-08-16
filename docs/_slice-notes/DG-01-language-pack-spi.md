# DG-01-language-pack-spi — staged doc updates (charter §10.2)

Issue: #245 · PR: #263 · Disposition: verified (prototype + measurements) with recorded provisional conclusions pending ADR-008 §11 cross-review

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #245 | [DG-01] Research spike: Language Pack SPI + PHP/Laravel route extraction | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-16 | **#245 (DG-01) Language Pack SPI + Laravel route spike DONE.** Reuse-first verified: upstream MIT + unpublished on npm → adaptation mechanism extended (tree-sitter-php@0.23.12 native, same npm artifact upstream declares); Language Pack SPI prototype + Laravel route-inventory layer behind the frozen SourceIndexer; koel (Laravel 13.24.0) measured 304 endpoint rows / 0 dynamic gaps / 0.0% PHP parse-failure over 1,412 files, BookStack (12.64.0) 335 rows / 1 parse error in 1,770 (blade-as-.php); license-clean Laravel fixture authored; spike report `docs/spikes/dg-01-language-pack-spi.md` feeds ADR-008 Decision 5. **Next: #246 (DG-02).** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- DG-01 Language Pack SPI prototype + Laravel route inventory (#245): PHP indexing through the frozen SourceIndexer seam via tree-sitter-php (the same npm grammar package upstream Understand-Anything declares), plus the Arxic-owned deterministic Laravel rule layer (verb/group/prefix/resource expansion ported from laravel/framework v13.24.0, PSR-4 controller convention resolution, literal foreach+interpolation resolution) emitting line-anchored EvidenceRefs with never-silent gap advisories (ARXIC-SOURCE-ROUTE-DYNAMIC-REGISTRATION, ARXIC-SOURCE-HANDLER-UNRESOLVED). Proven on koel (Laravel 13, 304 endpoints, 0% parse failure) and BookStack (Laravel 12, 1/1770 parse failure) against an Arxic-authored license-clean fixture in CI.
```

## 4. VERSION bump required?

no — research spike; no user-observable capability ships (PHP scanning exists but is not wired into any Action/pipeline stage yet; DG-05/DG-06 will make it user-observable and bump then).

## 5. Evidence pointers

- Real-world proof: `packages/source-ua-adapter/src/__tests__/laravel-fixture.test.ts` (complete-inventory end-to-end over the Arxic-authored Laravel fixture through `SourceUaAdapter.collect`, real tree-sitter-php engine) + local-only corpus runs via `packages/source-ua-adapter/scripts/measure-laravel.mjs` (koel/BookStack clones outside the repo).
- Artifacts: `docs/evidence/DG-01/koel-summary.json`, `docs/evidence/DG-01/bookstack-summary.json` (aggregate counts + commit SHAs, no source content). Spike report: `docs/spikes/dg-01-language-pack-spi.md`.
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (43 passing in package; full suite green) ☑ · license gate ☑ (tree-sitter-php@0.23.12, MIT)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                             | Expected disposition                                                            | Test                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------- |
| Route URI uses unresolvable interpolation                           | `observed` advisory ARXIC-SOURCE-ROUTE-DYNAMIC-REGISTRATION, no row             | `laravel-routes.test.ts`               |
| foreach over non-literal iterable declares routes                   | `observed` advisory, no silent skip                                             | `laravel-routes.test.ts`               |
| foreach over non-literal iterable declares NO routes (config files) | no advisory (walk-through) — proven on BookStack app/Config/*.php               | `laravel-routes.test.ts` + measurement |
| Controller class has no PSR-4 file                                  | route row emitted + ARXIC-SOURCE-HANDLER-UNRESOLVED                             | `laravel-routes.test.ts`               |
| Controller file lacks referenced method                             | route row emitted + ARXIC-SOURCE-HANDLER-UNRESOLVED                             | `laravel-routes.test.ts`               |
| Malformed PHP file                                                  | manifest `skipped/parse-error` + ARXIC-SOURCE-PARSE-ERROR diagnostic            | `php-surface.test.ts`                  |
| Policy narrowed to TS/JS                                            | php skipped with unsupported-language naming the real language (campaign shape) | `php-surface.test.ts`                  |
| Resource controller unresolvable                                    | apiResource rows still emitted + one advisory per distinct action               | `laravel-routes.test.ts`               |
