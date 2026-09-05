# FIX-299-plan-lane — staged doc updates (charter §10.2)

Issue: #299 · PR: #TBD · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #299 | [FIX-299-plan-lane] exploration plan lane selects candidates[0] blindly — form-drive plan never composes when candidate 0 is surface-less (F-E2; blocks DG-12 exit) | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-24 | **#299 (FIX-299-plan-lane) plan-lane surface-aware selection DONE.** The form-drive exploration plan now selects its candidate through the same surface-aware semantics as the compile lane (selectCompilableCandidate), extracted from the orchestrator into composeProposalFormDrivePlan (proposal-compile.ts) beside the selection it shares; the orchestrator shell only reads stage artifacts and forwards transient values. Red-first on the measured F-E2 shape (formless candidate 0 + surfaced candidate later: undefined where the plan should be); no-fabrication paths pinned (no plan when nothing resolves — never a guessed form). Proved by the #288 real-Chromium E2E journey (plan lane exercised end-to-end); on-target proof is the DG-12 campaign round 3 recorded on #256. **Next: #256 campaign round 3.** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-299 plan-lane surface-aware selection (#299): the form-drive exploration plan composes for the first candidate whose cited row has a crawl form surface (selectCompilableCandidate, shared with the compile lane) instead of blindly taking candidates[0] — the F-E2 campaign finding where directus-dg12-run2 blocked OBSERVATION-MISSING while 2 of 81 candidates cited the surfaced /admin routes. Extracted to composeProposalFormDrivePlan (service layer) with the honest no-plan shape (undefined when nothing resolves) unchanged.
```

## 4. `VERSION` bump required?

no — orchestration-internal fix; no user-observable contract change.

## 5. Evidence pointers

- Real-world proof: `apps/cli/src/__tests__/third-party-replay-e2e.real-world.test.ts` — the full CLI journey drives the plan lane (real Chromium, the reference auth app, per-pass replay login); on-target proof is the DG-12 campaign round 3 recorded on #256.
- Unit red-first: `packages/orchestrator-langgraph/src/__tests__/proposal-compile.test.ts` (`#299 (F-E2)` describe) — the formless-candidate-0 shape failed before the fix (undefined plan), passes after; both no-fabrication sad paths pinned.
- Artifacts: `docs/evidence/DG-12/directus/runs/directus-dg12-run2/` (the measured finding this fixes).
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (orchestrator 203/203, CLI real-world 7/7) ☐ license gate (CI)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                   | Expected disposition                                                                                    | Test                                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| candidate[0] cites a formless row; a later candidate cites a surfaced one | plan drives the surfaced candidate (observed → compilable)                                              | `skips a formless candidate[0] and drives the first form-surfaced candidate (the F-E2 shape)` |
| NO candidate resolves a crawl form surface                                | no plan (undefined) — exploration stays empty; compile blocks OBSERVATION-MISSING, never a guessed form | `composes no plan (undefined) when NO candidate resolves a form surface — never guesses`      |
| candidate[0] matches no proposal/row                                      | no plan (undefined) — unchanged honest shape                                                            | `keeps the no-plan honest shape when the first candidate is unresolvable to a proposal/row`   |

## 7. Not done / known-weak spots

- The E2E stub-model route to a RED #299-shaped end-to-end test was explored and dropped: the inventory the stub receives only carries `GET /` (form-surfaced in the fixture), so a formless-first candidate list cannot be expressed there cheaply. The unit seam (extracted service function) carries the red-first proof; the on-target proof is the campaign round 3.
- `composeProposalFormDrivePlan` is a verbatim extraction of the previous in-orchestrator logic (plus the selection swap); behavior parity is covered by the pre-existing exploration/orchestrator suites (203/203), not by a dedicated golden test.
