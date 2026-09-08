# WEB-402-ROUTE-OMISSIONS — staged doc updates (charter §10.2)

Issue: #402 · PR: #<PR> · Disposition: observed (an LLM assigns at most `observed`; the deterministic suites are the proof)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
(No milestone row — #402 slice; record under the #402 status paragraph.)
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-09 | **#402 (WEB-402-ROUTE-OMISSIONS) per-route omission coverage DONE.** The first unchecked #402 acceptance criterion gains its deterministic source-tier core: condition declarations carry their bounded collapsed source text (`ternary expression (source condition): error ? …`), and a pure route-coverage service associates each discovery route row's source files (plus same-directory siblings, never nested surfaces — a mid-implementation red caught the root-route-swallows-the-tree overreach and fixed the association rule, no assertion loosened) with five documented dimensions: state:loading / state:error / state:empty (pattern table over condition/state labels), tests (associated file or colocated `<file>.test.*` pair), docs (associated file or route path named). The intent inventory panel renders per-route referenced/absent chips with line-anchored evidence and the honesty boundary ("absent marker ≠ proof of absent behavior"); persona/feature-flag-value/action-result stay unobserved dimensions. Proven red-first on the real stack (real adapter → buildSourceInventory → collectFrontendInventory → service over the real reference fixture plus an overlay route with its own loading ternary and colocated test): /login error referenced from BOTH its real page ternary and the actions redirect, / all-absent, tests/docs absent per route; real-Chromium panel journey; adapter 69/69 + web units 16/16 with the pre-existing kind-based condition pin untouched. Next #402: authenticated visual checkpoints, runtime/worker/retention controls, paid inference, the human gate. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### <added|changed|fixed|security|internal>`

```
### Added

- WEB-402-ROUTE-OMISSIONS per-route omission coverage in source discovery (#402): condition declarations now carry their bounded source condition text, and the intent inventory panel exposes, for every discovered route, which conditional states (loading/error/empty) the route's own source files reference — with line-anchored evidence — and whether any test or documentation declaration covers them. Association is deterministic (route source files plus same-directory siblings; colocated test-file pairing); absence is an omission signal to investigate, never proof of absent behavior, and runtime dimensions (persona, flag values, action results) remain explicitly unobserved.
```

## 4. `VERSION` bump required?

no (integrator folds; user-observable capability — candidate bump at fold time, integrator's call)

## 5. Evidence pointers

- Real-stack proof: `apps/web/src/__tests__/route-coverage.test.ts` — the REAL discovery stack (SourceUaAdapter → buildSourceInventory → collectFrontendInventory) over the real reference-auth-app repository plus an overlay `app/status` route (own loading ternary + colocated `page.test.tsx`): loading/tests referenced with evidence, error/empty absent; real `/login` error referenced from its own page ternary AND the sibling actions redirect; `/` all-absent; fixed dimension order; pure-derivation equality.
- Source-tier proof: `packages/source-ua-adapter/src/__tests__/frontend-conditions.test.ts` — real fixture condition rows carry bounded condition text (`ternary expression (source condition): error ? …`, `… message ? …`), label cap respected, deterministic recollection.
- UI proof: `apps/web/src/__tests__/route-coverage-ui.real-world.test.ts` — real Chromium through the real dashboard: onboarding → discovery → intent inventory renders the section with `GET /login` (error referenced, loading/empty/tests absent) and `GET /` all-absent, plus the honesty wording.
- Artifacts: `docs/evidence/WEB-402-ROUTE-OMISSIONS/{red,green}.txt` (including the mid-implementation red that fixed the root-directory association overreach).
- Gates: typecheck ☑ (root + `typecheck:packages` + `@arxic/web`) · lint ☑ · format ☑ full repo · test ☑ (adapter 69/69, web units 16/16, three new lanes) · license gate — CI `package` job.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                | Expected disposition                                                                                           | Test                                                                      |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| nested route surface under a route's directory (root page vs app tree) | NOT associated — nested surfaces own their routes; root route gets only same-directory siblings                | `route-coverage.test.ts` (`/` all-absent vs `/status` loading referenced) |
| global test file (`__tests__/boot.test.ts`) covering no route files    | tests dimension ABSENT for every route (honest omission, not credit by proximity)                              | `route-coverage.test.ts`                                                  |
| route without sourceRefs / scan-diagnostic rows (`method '*'`)         | excluded from coverage (nothing to associate)                                                                  | service guard                                                             |
| browser bundle import of the service                                   | type-only imports — no node builtin may enter the browser bundle (caught as a bundling error, fixed by design) | dashboard build in `route-coverage-ui.real-world.test.ts` boot            |
| absent marker misread as proof                                         | panel wording pins "not proof of absent behavior"; unobservedDimensions unchanged                              | UI journey assertion                                                      |
