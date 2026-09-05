# DG-283 — staged doc updates (charter §10.2)

Issue: #283 · PR: (this slice's PR) · Disposition: mixed (deterministic gates
green locally at the final SHA — CI on the PR head pending at authoring time;
`verified` stays the owner/validator's call per ADR §2)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #283 | [DG-283] Implement: laravel-auth rulepack — truthful frameworks [laravel] passes the DG-10 gate | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-20 | **#283 (DG-283) laravel-auth rulepack DONE.** New `rulepacks/laravel` (pack `laravel-auth@0.1.0`, framework `laravel` range `>=13 <14`, one real rule `laravel-route` — PHP, category `route`, `Route::$METHOD($PATH, $$$ARGS)` facade pattern with verb + literal-path constraints, complete metadata.arxic) + pack-local positive/negative fixtures mirroring real koel `routes/api.base.php` syntax; enlisted in the fixture discipline (`test-repo.ts` packDirs, `expectedFields['laravel-route']='PATH'`). Gate tests flipped per the frozen #283 contract: CLI acceptance scenario (`frameworks: [laravel]` + pinned koel composer fixtures → executor reached, zero blocked, ACCEPTED observed naming 13.24.0 lockfile-tier), retained unknown-framework exit-2 case (AC-5, renamed to symfony), new SP-3 out-of-range rejection (composer.lock v14.0.0 → REJECTED blocked, exit 2 pre-crawl), SP-4 laravel waiver pin (exact framework+version+current-range → WAIVED; malformed → ARXIC-RULES-WAIVER-INVALID blocked), SP-2 UNDETECTED non-blocking (adapter-level on record; the CLI gate layer elides UNDETECTED by frozen design). Real-engine proof: rule OBSERVED matching koel-shaped registrations on the CI-pinned ast-grep 0.45.1 with zero negative matches and zero errors on .ts inputs; G-0 harness reproduced the blocked baseline byte-identically pre-implementation and the flipped G-3 harness (real koel clone @ dfec91ff, read-only) reached the executor with zero blocked diagnostics post-pack. DG-11 koel template + README flipped to truthful `frameworks: [laravel]` with the resolved-state notice (express workaround retired). Full G-1 suite 65/65; license + tarball gates green. **M-ALL-Domain Intent: <n>/<total> — integrator to fill.** Next: DG-11 G-3 real runs, DG-12. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- DG-283 laravel-auth rulepack (#283): `rulepacks/laravel` ships `laravel-auth@0.1.0` (framework `laravel`, normative range `>=13 <14`) with the `laravel-route` PHP rule (Route-facade verb + literal-path registration, metadata-complete, pack-local fixture discipline); a truthful `frameworks: [laravel]` declaration now passes the DG-10 gate for a clean Laravel 13 clone — ACCEPTED observed from composer.lock lockfile-tier evidence (koel 13.24.0 at the DG-05 pin), out-of-range pins still REJECTED blocked pre-crawl, exact-match waivers still honored and malformed waivers still fail closed; the DG-11 koel template declares the truthful framework and the express workaround is retired. Proved with the real ast-grep engine (CI-pinned 0.45.1) against koel-shaped route syntax, the pinned koel composer fixtures, and the real koel clone at the ratified pin (gate phase, read-only).
```

## 4. `VERSION` bump required?

no — additive rulepack + test/doc changes only; no user-observable CLI/pipeline
behavior changed for existing packs (the DG-10 gate semantics are untouched;
`laravel` merely joins the available list).

## 5. Evidence pointers

- Real-world proof: `packages/ast-grep-adapter/src/__tests__/rule-fixtures.test.ts` (laravel-route fixture discipline on the real ast-grep engine) and `packages/ast-grep-adapter/src/__tests__/framework-gate.test.ts` (pinned koel composer.json/composer.lock excerpts at the DG-05 pin — laravel/framework v13.24.0 lockfile-tier acceptance, SP-2/3/4 semantics); `apps/cli/src/__tests__/framework-gate.test.ts` (end-to-end runAction gate scenarios). G-3 harness (real koel clone @ dfec91ff…, read-only, stub executor) run at the final SHA — JSON posted as EVIDENCE on #283.
- Artifacts: harness JSON outputs (baseline + final) on issue #283; no screenshots (non-visual change).
- Gates: typecheck ☐ · lint ☐ · format ☐ · test (65/65 G-1 suites) ☐ · license gate ☐ — checkboxes flipped by the integrator after `ci` passes on the PR head (repo reporting discipline: done means `gh pr checks` prints `pass`).

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                           | Expected disposition                                                                                                                                      | Test                                                                                                                                                 |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rulepacks/laravel/pack.json` malformed or empty rules dir        | ARXIC-RULES-PACK-INVALID blocked, fail closed (structural refusal, `packs.ts:80`; SP-1 coverage retained by the existing suite)                           | `sad-paths.test.ts` (malformed pack matrix)                                                                                                          |
| `frameworks: [laravel]`, no laravel version evidence in target    | UNDETECTED observed, non-blocking, run proceeds (SP-2; adapter emits it on record — CLI gate layer elides it by frozen design, asserted at adapter level) | `framework-gate.test.ts` (adapter) SP-2; CLI SP-2 proceeds-no-block                                                                                  |
| composer.lock pins laravel/framework v14.0.0 (outside `>=13 <14`) | REJECTED blocked, exit 2 pre-crawl, zero rules run (SP-3)                                                                                                 | `framework-gate.test.ts` (adapter + CLI) SP-3                                                                                                        |
| Out-of-range + committed exact-match `arxic.waivers.json`         | WAIVED observed, run proceeds; malformed waiver → ARXIC-RULES-WAIVER-INVALID blocked, fail closed (SP-4)                                                  | `framework-gate.test.ts` (adapter + CLI) SP-4                                                                                                        |
| Framework with no installed pack (symfony post-slice)             | ARXIC-RULES-FRAMEWORK-UNKNOWN blocked, exit 2 pre-crawl, path-free message (C-6/AC-5; cell 3/3b renamed off laravel)                                      | `framework-gate.test.ts` (adapter cell 3/3b, CLI retained case)                                                                                      |
| PHP rule scanned against TypeScript paths                         | zero matches, no sg error (portability of the all-pack scan over ts/tsx repos)                                                                            | OBSERVED on ast-grep 0.45.1 pre-implementation; guarded by `sad-paths.test.ts` / `contract-gate.test.ts` running all packDirs rules over ts fixtures |
