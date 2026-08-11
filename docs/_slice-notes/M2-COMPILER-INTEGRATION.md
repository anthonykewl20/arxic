# M2-COMPILER-INTEGRATION — staged doc updates (charter §10.2)

Issue: refs #116 · PR: TBD · Disposition: **CODE COMPLETE on branch; PR + CI + post-merge doc fold pending.** Slice D (compiler integration) — the gate + wrapper land in `@arxic/intent` (D1), the orchestrator's stage-9 `#compile` runs the gate and closes two confirmed P1 gaps (D2). `@arxic/playwright-compiler` is **byte-identical / IntentSpec-free** by design.

---

## Architecture decision (decided by reviewer-deepseek against ADR-004 §3 source)

Two consensus reviewers disagreed on where the IntentSpec→compiler gate lives. **consensus-luna:** in `@arxic/playwright-compiler` (new `compileWithIntent` method; compiler deps on intent). **consensus-terra:** in `@arxic/intent` (wrapper Service; compiler stays pure). reviewer-deepseek ruled **adopt terra, reject luna**, citing ADR-004 §3 verbatim:

- "`@arxic/intent` owns reusable Service mechanics: … **conversion of an already-resolved IntentSpec to compiler input**."
- "**The compiler must not duplicate oracle resolution, exploration policy, or failure classification.**"
- The dep arrow `intent -> playwright-compiler -> verifier` (luna's design inverts it).

The frozen `WorkflowCompiler.compile(workflow, observations)` signature is exactly WHY the gate must live outside the compiler as a wrapper. The gate matches on exact byte-for-byte `intent` string with **multiset (bag) semantics** (one resolved assertion satisfies at most one emitted assertion). `expectedValue`-matching is a category error (the frozen `WorkflowAssertion` has no such field).

Deepseek also confirmed two P1 gaps in the orchestrator (both fixed in D2): (1) `#compile` invoked the seam even after a blocked/contradicted oracle resolution; (2) a characterization-only IntentSpec (all `observed-only`) left `promotionEligible === true`, so stage-10 `verified` would promote it — contradicting ADR-004 §2 ("characterization… cannot justify `verified`").

## Deferrals (out of slice D, tracked)

- **`defaultCompile` generator swap** (`generateSpecFromWorkflow` → `compileWithIntentSpec` over a real `PlaywrightCompiler`): ADR §4 step 6 names `packages/playwright-compiler`, but swapping the orchestrator's default generator is a behavioral change deserving its own real-world-proven slice. Slice D's security guarantee is achieved by the gate running in `#compile` before EITHER compile path, so coverage is identical with or without the swap. Filed as a follow-up.
- **Locator-provenance run-local artifact:** `StepObservation.locatorResolution` is dropped at `exploration.ts:225-235` when building runtime `EvidenceRef`s (frozen contract can't carry it). ADR §4 step 6's "run-local provenance/evidence artifacts" ultimately needs this for full locator provenance. Slice D's gate covers oracle/source/runtime provenance only. Filed as a follow-up.

## Consensus-review residuals (non-blocking, tracked for slice E/F)

reviewer-hy3 + reviewer-deepseek both APPROVE. Corroborated residuals (both flagged; none blocking):

- **Mixed-spec promotion fineness (deepseek P2):** `hasAcceptance` (gap #2) is a coarse `some` — a _mixed_ IntentSpec (one trivial acceptance + characterization over a genuinely-required transition) yields `promotionEligible:true` at stage 9. Gap #2 closed only the characterization-_only_ case. Bounded (actual promotion still requires stage-10 `verified`), but the finer per-required-transition acceptance-strength guard belongs with the ADR-004 §2 "characterization cannot justify verified by itself" nuance — litigate at slice F (ADR-004 Accepted flip + two-app proof). Slice D's gate still guarantees every required assertion has a resolved match.
- **Presence-only evidence recheck (hy3):** the gate rechecks acceptance evidence as non-empty `source`/`runtime` arrays, not `EvidenceRef` resolvability. A fabricated-but-populated ref slips the gate; the stage-10 verifier is the real evidence gate. By design.
- **`required === false` gate-skip untested directly (deepseek P3):** the contract default (`required !== false`) is covered, but no unit test pins the gate's `required === false` skip branch. Add one.
- **Plan-message wording (hy3):** the blocked-early-return `plan` literal says "Oracle resolution blocked compilation" even when `oracleOutcome === 'contradicted'`. Cosmetic; conflates contradicted with blocked in the message only.
- **`compileWithIntentSpec` is production-dead (deepseek P3):** exported + tested, but only the gate is wired into `#compile`. When the `defaultCompile` swap lands, route it through `compileWithIntentSpec` (single gate entry point) rather than leaving two.

---

## 1. `docs/SYNC.md` — tracker row (ready for integrator at merge)

```
| #116 | [M2 design + impl] Intent-backed pseudocode (IntentSpec) — ADR-004 design landed; **slices A + B + C + D landed** (D = compiler integration, PR <N>); slices E–F pending | 🚧 in progress (4 of 6 slices) |
```

## 2. `docs/SYNC.md` — session-log row (ready for integrator at merge)

```
| 2026-08-11 | **#116 slice D (M2-COMPILER-INTEGRATION) landed via PR <N> (CI <status>).** Closes the IntentSpec→compiler boundary per ADR-004 §4 step 6. The gate + wrapper live in @arxic/intent (decided by reviewer-deepseek against ADR-004 §3: intent owns "conversion of an already-resolved IntentSpec to compiler input"; the compiler must not duplicate classification; preserves the intent->playwright-compiler arrow — consensus-luna's compiler-side gate was rejected as an inverted dep). New `packages/intent/src/compile-bridge.ts`: `enforceIntentProvenancePolicy(workflow, intentSpec)` does exact-`intent` multiset matching of required-transition assertions against resolved IntentSpec assertions (one resolved satisfies at most one emitted; rejects coverage gaps + over-emission via new `ARXIC-INTENT-WORKFLOW-COVERAGE-GAP`, rechecks acceptance evidence via reused `ARXIC-INTENT-SOURCE-AS-ACCEPTANCE`, ACCEPTS characterization — promotion is the orchestrator's job); `compileWithIntentSpec` runs the gate then calls the frozen `compile()`. The orchestrator stage-9 `#compile` runs the gate before classification (coverage gaps flip oracleOutcome to blocked via existing sticky machinery), closes two P1 gaps: (1) blocked/contradicted oracle → no seam call, `compiled:false`, `promotionEligible:false`; (2) characterization-only IntentSpec → `promotionEligible:false` via `hasAcceptance` guard (conjunctive aggregation means stage-10 verified can't override). `@arxic/playwright-compiler` unchanged. `defaultCompile` generator swap + locator-provenance artifact deferred (follow-ups). Gates green (typecheck/typecheck:packages/lint/test 10 files/83 + intent 42/format:check). Slice D of 6. Next: slice E. |
```

## 3. `CHANGELOG.md` — entry (ready for integrator at merge)

```
- M2-COMPILER-INTEGRATION intent→compiler provenance gate + orchestrator wiring — slice D of #116 (#116 stays open): new `@arxic/intent` `compile-bridge.ts` gates the compiler boundary — `enforceIntentProvenancePolicy` does exact-`intent` multiset matching of required-transition assertions against resolved IntentSpec assertions (coverage gaps + over-emission → `ARXIC-INTENT-WORKFLOW-COVERAGE-GAP`; acceptance evidence rechecked via `ARXIC-INTENT-SOURCE-AS-ACCEPTANCE`; characterization accepted, promotion is the Action's job); `compileWithIntentSpec` wraps the frozen `compile()`. The orchestrator stage-9 runs the gate before classification and closes two gaps: blocked/contradicted oracle no longer compiles, and characterization-only specs are not promotion-eligible (ADR §4 §2 — cannot justify `verified`). `@arxic/playwright-compiler` unchanged (gate lives in intent per ADR-004 §3). `defaultCompile` generator swap + locator-provenance artifact are tracked follow-ups.
```

## 4. `VERSION` bump required?

no — `@arxic/intent` and `@arxic/orchestrator-langgraph` remain private; the frozen `WorkflowCompiler` contract is unchanged.

## 5. Evidence pointers

- D1 gate proof: `packages/intent/src/__tests__/intent.test.ts` — 38 unit tests incl. red-first coverage-gap, over-emission, acceptance-evidence, characterization-accepted; loop-close 6→7. `packages/intent/src/__tests__/real-world.test.ts` — drives the real `authCandidates` pack over BOTH apps' real `authSurface` data through the gate (reference `url:/` + Express `text:Logged in`).
- D2 wiring proof: `packages/orchestrator-langgraph/src/__tests__/oracle-resolution.test.ts` — real `LangGraphOrchestrator` stage-9: blocked oracle → no seam call (gap #1); characterization-only → not promotion-eligible through stage-10 (gap #2); coverage gap → blocked; acceptance-backed → compiles + promotion-eligible.
- Gates: typecheck ☑ · typecheck:packages ☑ · lint ☑ · `vitest run packages/intent` 42 ☑ · `vitest run packages/orchestrator-langgraph` 10 files / 83 ☑ · format:check ☑ (run LAST). Full `pnpm test` run by main agent before PR.

## 6. Sad paths proved

| Trigger                                                             | Expected disposition                                                               | Test                                                      |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Required workflow assertion with no resolved IntentSpec match       | blocked / `ARXIC-INTENT-WORKFLOW-COVERAGE-GAP`                                     | intent gate coverage-gap test                             |
| Same `intent` emitted twice, one resolved assertion (over-emission) | blocked / `ARXIC-INTENT-WORKFLOW-COVERAGE-GAP`                                     | intent gate over-emission test                            |
| Acceptance match with empty source OR runtime evidence              | blocked / `ARXIC-INTENT-SOURCE-AS-ACCEPTANCE`                                      | intent gate acceptance-evidence tests                     |
| Characterization match on a required transition                     | ACCEPTED by the gate (promotion is the Action's job)                               | intent gate characterization-accepted test (boundary pin) |
| Blocked/contradicted oracle outcome                                 | no compile seam call; `compiled:false`; `promotionEligible:false` (gap #1)         | orchestrator blocked-before-compile test                  |
| Characterization-only IntentSpec, stage-10 returns verified         | run stays non-promotable (gap #2, `hasAcceptance` guard + conjunctive aggregation) | orchestrator characterization-not-promotable test         |
| Gate failure on injected `#options.compile` path                    | blocked via gate-in-`#compile` (covers ALL compile paths)                          | orchestrator coverage-gap test                            |

---

## Honest notes for the integrator

- This is a charter §10 parallel slice; the note above IS the doc deliverable. Fold sections 1–3 into SYNC/CHANGELOG at merge; delete this file.
- Two follow-ups filed (not blocking): `defaultCompile` generator swap (ADR §4 step 6 faithfulness); locator-provenance run-local artifact (`exploration.ts:225-235` drops `locatorResolution`; frozen `EvidenceRef` can't carry it).
- `@arxic/playwright-compiler` is intentionally untouched — that's the point of the terra architecture. Any future "compiler-side gate" proposal must re-litigate ADR-004 §3.
- Consensus was sought (luna vs terra); deepseek decided against the ADR source. "Prefer ground truth to agreement" — same pattern as slice C's numeric-credential closure.
