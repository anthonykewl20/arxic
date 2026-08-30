# DG12-EXPLORATION-FRAGMENT-MATCH — staged doc updates (charter §10.2)

Issue: #348 · PR: not opened · Disposition: mixed (observed campaign defect; blocked compilation remains honest until a rerun)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #348 | [gate-finding] exploration URL comparison is fragment-sensitive: hash-router SPA observations falsely reported TRANSITIONS-UNOBSERVED (koel dg12-hostbound-run4) | ☑ done (code; field rerun pending) |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-30 | **#348 (DG12-EXPLORATION-FRAGMENT-MATCH).** Corrected stage-8 navigation resource matching to strip browser-only fragments before its existing trailing-slash comparison, so the recorded koel `/#/home` observation matches the planned `/` route while path/query/origin mismatches stay distinct. Also mapped common persona label variants (`Your email address`, `Your password`) to the CLI's transient `persona.email`/`persona.password` values, allowing a supplied Koel persona to compose fills plus submit. The original run also had no stage-7 persona lease, an operator launch condition; no credentials are persisted. Red-first orchestrator unit tests passed; a real campaign rerun remains required before any replay claim. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- DG12-EXPLORATION-FRAGMENT-MATCH (#348): stage-8 treats hash-router fragments as browser-only when comparing observed navigation resources, retaining trailing-slash normalization and distinct-path/query/origin checks; proposal form drives recognize common email-address and password label variants as supplied persona inputs.
```

## 4. `VERSION` bump required?

no — internal stage-8 comparison and proposal input-reference correction; no public contract or schema changes.

## 5. Evidence pointers

- Defect evidence: local-only campaign artifact `docs/evidence/DG-12/koel/runs/koel-dg12-hostbound-run4/artifacts/08.json` records `Observed "observe route /" at http://127.0.0.1:20647/#/home` followed by `ARXIC-EXPLORATION-TRANSITIONS-UNOBSERVED [observed]`.
- Root-cause evidence: the same run's `artifacts/05.json` inventories the root GET form with `Your email address`/`Your password`; `artifacts/07.json` has no persona lease. The directus comparison run's `artifacts/08.json` records Email/Password fills and submit.
- Red-first tests: `packages/orchestrator-langgraph/src/__tests__/exploration.test.ts` — hash-router match and distinct-path rejection; `packages/orchestrator-langgraph/src/__tests__/proposal-compile.test.ts` — Koel label variants compose navigate/fill/fill/click with the actual persona input vocabulary.
- Gates: typecheck passed · lint passed · format passed after this note · test (56 passing) passed · license gate not run (not requested).

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                               | Expected disposition                                                                                          | Test                                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Observed hash-router URL `/#/home` for planned `/`                    | same resource is observed; no false transitions-unobserved decision                                           | `matches a hash-router navigation modulo fragment and trailing slash, but not a different path` |
| Observed `/admin/login` for planned `/admin`                          | remains distinct and records transitions-unobserved as observed                                               | same test, distinct-path assertion                                                              |
| `Your email address` and `Your password` with supplied persona values | navigate, both fills, and submit are composed; post-action can be captured only after the real drive succeeds | `maps labelled email-address and password fields to the supplied persona values`                |
| No complete persona env (recorded original run)                       | no lease and navigate-only plan; compilation remains blocked rather than fabricating an observation           | recorded `artifacts/07.json`; existing missing-observation compile test                         |
