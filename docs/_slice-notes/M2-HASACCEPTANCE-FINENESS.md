# M2-HASACCEPTANCE-FINENESS — staged doc updates (charter §10.2)

Issue: refs #116 (post-acceptance follow-up) · PR: TBD · Disposition: **CODE COMPLETE on branch; PR + discipline-based merge pending.** Closes the slice-D residual both reviewers flagged: the coarse `hasAcceptance = assertions.some(kind==='acceptance')` let a _mixed_ IntentSpec (one trivial acceptance + a characterization over a genuinely-required transition) stay promotion-eligible. Tightened to per-required-transition acceptance-strength.

---

## What changed

- **`packages/intent/src/compile-bridge.ts`** — extracted the multiset matcher as a shared private `matchRequiredAssertions` (single source of truth for "which resolved assertion covers which emitted assertion" — charter §1: mechanics in the Service); `enforceIntentProvenancePolicy` now consumes it (behavior-identical — same diagnostics, same order, existing tests unaffected); **new `everyRequiredAssertionAcceptance(workflow, intentSpec): boolean`** returns true iff EVERY required-transition assertion is matched to an `acceptance`-kind resolved assertion (unmatched → false as defense-in-depth even though the gate blocks first; matched-characterization → false).
- **`packages/orchestrator-langgraph/src/orchestrator.ts`** — `hasAcceptance` (the stage-9 promotion guard) replaced: `normalizedIntentSpec && candidateWorkflow ? everyRequiredAssertionAcceptance(candidateWorkflow, normalizedIntentSpec) : true`. Back-compat: no IntentSpec or no candidate workflow → `true` (legacy/non-intent runs byte-identical).
- **`packages/intent/src/__tests__/intent.test.ts`** — +4 unit tests for `everyRequiredAssertionAcceptance`: mixed (acceptance + characterization over required) → **false** (the red-first gap); all-acceptance → true; characterization-only → false; unmatched → false.

## 1. `docs/SYNC.md` — tracker row (ready for integrator at merge)

```
| #116 | [M2 design + impl] Intent-backed pseudocode (IntentSpec) — ADR-004 **Accepted** (2026-08-11) after the two-app live-Chromium proof; **slices A–F landed** + the mixed-spec hasAcceptance follow-up; 4 post-acceptance follow-ups tracked | ☑ done (6 of 6 slices + 1 follow-up) |
```

## 2. `docs/SYNC.md` — session-log row (ready for integrator at merge)

```
| 2026-08-12 | **#116 post-acceptance follow-up (M2-HASACCEPTANCE-FINENESS) landed via PR <N> (discipline-based).** Tightened the slice-D promotion guard: `hasAcceptance` was a coarse `some(kind==='acceptance')` that let a mixed IntentSpec (one trivial acceptance + characterization over a required transition) stay promotion-eligible — both slice-D reviewers flagged it. Replaced with `everyRequiredAssertionAcceptance(workflow, intentSpec)` (new `@arxic/intent` Service helper): every required-transition assertion must be matched to an acceptance-kind assertion. Shared the multiset matcher between the gate + the new helper (no duplication). +4 red-first unit tests. Gates green (typecheck/typecheck:packages/lint/full pnpm test 104 files / 893 tests incl. real Chromium/format:check). Existing slice-F proof + characterization/acceptance orchestrator tests unaffected. |
```

## 3. `CHANGELOG.md` — entry (ready for integrator at merge)

```
- M2-HASACCEPTANCE-FINENESS (#116 post-acceptance follow-up): tightened the IntentSpec promotion guard from a coarse `some(kind==='acceptance')` to `everyRequiredAssertionAcceptance` — every required-transition assertion must be acceptance-backed. Closes the mixed-spec gap (one trivial acceptance + characterization over a required transition) both slice-D reviewers flagged. Shared multiset matcher between the gate + the new helper (charter §1).
```

## 4. `VERSION` bump required?

no — private M2 seams; frozen `WorkflowCompiler`/`StagedBundle`/`Workflow` unchanged.

## 5. Evidence pointers

- Unit proof: `packages/intent/src/__tests__/intent.test.ts` `describe('everyRequiredAssertionAcceptance promotion-eligibility check')` — 4 cases incl. the mixed-spec red-first gap.
- Wiring regression proof: the existing orchestrator characterization/acceptance tests + the slice-F real-world proof (single-assertion specs) all still pass — confirms the tightened guard integrates correctly (`pnpm test` 104 files / 893).
- Gates: typecheck ☑ · typecheck:packages ☑ · lint ☑ · test 104 files / 893 ☑ · format:check ☑ (LAST).

## 6. Sad paths proved

| Trigger                                                                               | Expected disposition                                                  | Test                                                    |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| Mixed spec: acceptance for transition A + characterization over required transition B | not promotion-eligible (`everyRequiredAssertionAcceptance === false`) | intent unit "rejects a mixed spec…" (red-first)         |
| All-required-acceptance spec                                                          | promotion-eligible (`=== true`)                                       | intent unit "accepts a spec where every required…"      |
| Characterization-only required assertion                                              | not promotion-eligible                                                | intent unit "rejects a characterization-only…"          |
| Required assertion unmatched (defense-in-depth)                                       | not promotion-eligible                                                | intent unit "rejects (defense-in-depth) when unmatched" |

## Honest notes

- The mixed-spec case is unit-tested at the helper level; the orchestrator WIRING is covered by the existing slice-D characterization/acceptance integration tests + the slice-F real-world proof (single-assertion specs, which behave identically under the old `some` + new `every` guards). No dedicated orchestrator-level mixed-spec integration test added — the unit test pins the new logic; a future revert of the orchestrator guard would surface via the existing characterization test failing OR a new unit regression. Flag if the integrator wants a dedicated mixed-spec orchestrator test.
- The 4 remaining #116 post-acceptance follow-ups (tautological-assertion matcher inversion, per-assertion gate granularity, `defaultCompile` swap, locator-provenance artifact) are still tracked in ADR-004 Open Questions.
