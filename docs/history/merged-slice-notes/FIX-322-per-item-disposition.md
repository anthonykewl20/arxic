# FIX-322-per-item-disposition — slice note

Issue: #322 · Status: fixed on this branch, awaiting CI + AC-4 round-16 field proof · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #322 | [FIX-322-per-item-disposition] per-item semantic gaps disposition instead of blocking — SURFACE-MISSING (stage 9) and PROVIDER-INCLUDE-RESOLVED/UNRESOLVED (stage 13) emit observed-severity records; codes and messages unchanged; ADR-008 Decision 2 honored | ☑ done (code; AC-4 round 16 pending) |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-25 | **#322 (FIX-322-per-item-disposition) disposition-and-continue.** Round-15 koel field evidence: the PHP/Laravel lane (required by the ADR-008 exit gate) blocked on TWO per-item gaps — ARXIC-ORCH-PROPOSAL-SURFACE-MISSING (one proposed API route /api/podcasts/:param/subscriptions with no UI form; no proposal cited the single form-backed row `/` because stage 13 runs pre-crawl, observedForms=[]) and ARXIC-INVENTORY-PROVIDER-INCLUDE-UNRESOLVED ×2 (runtime-computed Laravel include paths). Both contradict ADR-008 Decision 2 (inventory completeness separate from replayability; every row dispositioned; no row blocks). Fix: BOTH emit observed severity — the exclusion/gap is a recorded fact, not a policy violation (observed never blocks, first line of diagnosticBlocksStage; no code/message changed; also fixes the latent RESOLVED-emits-blocked bug that would have blocked any PHP app with RESOLVABLE includes). Red-first ×3: e2e orchestrator run with a proposal citing a formless API row (pre-fix outcome blocked at exactly the koel condition; post-fix observed, SURFACE-MISSING retained, no stage-9 STAGE-BLOCKED); unit on compileProposalCandidate severity; unit on resolveProviderIncludes both severities. **Next: DG-12 round 16 koel under #256 (AC-4: completes with dispositioned ledger); exit-gate evaluation follows — form-blind inference (observedForms only known post-crawl) is the known structural gap to measure honestly.** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-322 per-item disposition (#322): a proposal whose cited row has no crawl form surface (SURFACE-MISSING) and provider-include gaps/resolutions (PROVIDER-INCLUDE-UNRESOLVED/RESOLVED) are per-item disposition records with observed severity — recorded, never dropped, never blocking the run — honoring ADR-008 Decision 2 (inventory completeness is separate from replayability).
```

## 4. `VERSION` bump required?

no — severity classification of two existing diagnostic codes; no contract or schema change (the codes, subjects, and messages are byte-identical).

## 5. Evidence pointers

- Defect evidence: `docs/evidence/DG-12/koel/runs/koel-dg12-run15/` — stage-9 STAGE-BLOCKED via PROPOSAL-SURFACE-MISSING (route:/api/podcasts/:param/subscriptions), stage-13 STAGE-BLOCKED via PROVIDER-INCLUDE-UNRESOLVED ×2 (app/Providers/{BroadcastServiceProvider,RouteServiceProvider}.php); inventory root-cause: the single form-backed row `/` has observedForms=[] because stage 13 runs before the crawl, so inference was blind to it and no proposal cited it; reported on #256 (round-15 comment).
- Fix: `packages/orchestrator-langgraph/src/proposal-compile.ts` (SURFACE-MISSING → observed), `packages/domain-inventory-spike/src/provider-includes.ts` (RESOLVED + UNRESOLVED → observed).
- Red-first tests: sad-paths e2e 'dispositions a formless proposal instead of blocking the run (#322)' (failed pre-fix on the severity assertion with outcome blocked — the exact round-15 condition); proposal-compile unit 'emits SURFACE-MISSING as an observed disposition, not a block (#322)'; provider-includes unit 'records include resolutions and gaps as observed dispositions, never blocks (#322)'.
- Gates: orchestrator-langgraph + domain-inventory-spike 31 files / 304 tests; verifier + m0-pipeline + cli + intent-proposal-spike 35 files / 347 tests; typecheck/lint clean; `format:check` after this note: see report.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                             | Expected disposition                                                                                                                                                                             | Test                                                                  |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| proposal cites a formless API row (koel shape), real crawl finds the unrelated form | run outcome observed; SURFACE-MISSING retained as observed record; no stage-9 STAGE-BLOCKED; nothing fabricated (observed, end-to-end)                                                           | 'dispositions a formless proposal instead of blocking the run (#322)' |
| compile lane, no form surface for the selected row                                  | compiled=false + observed-severity record, code unchanged (observed, unit)                                                                                                                       | 'emits SURFACE-MISSING as an observed disposition…'                   |
| provider include resolved / unresolvable                                            | both recorded observed; gap stays visible; interchange validity unchanged (observed, unit)                                                                                                       | 'records include resolutions and gaps as observed dispositions…'      |
| OBSERVATION-MISSING after a failed drive                                            | STILL blocks (out of #322 scope: an operationally failed drive is a real failure, not a disposition) — pinned by the existing 'blocks honestly when the post-action observation is missing' test | unchanged                                                             |

## 7. Not done / known-weak spots

- AC-4 executes as round 16 under #256 after this merges. Expected honest outcome: koel COMPLETES with a dispositioned ledger but ZERO compilable proposals (no proposal cites the form-backed `/` row) → exit-gate criterion 3 vacuous on koel and criterion 2 (≥80% grounded) measured honestly — koel currently grounds ~46% (146/315), so the ADR-008 flip is NOT expected this round; the structural cause (inference is form-blind because the crawl runs after stage 4; observedForms=[] at proposal time) will file as its own finding after round 16 measures it.
- The severity switch is disclosed as a deliberate classification change (blocked → observed) on two codes; no matcher was loosened — the codes, subjects, and messages are byte-identical, and OBSERVATION-MISSING deliberately keeps blocking.
- The e2e test does not assert `result.status` (partial vs completed is the run coordinator's call); it asserts the blocking-relevant facts (outcome, diagnostics, no stage-9 STAGE-BLOCKED).
