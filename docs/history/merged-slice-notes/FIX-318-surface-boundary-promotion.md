# FIX-318-surface-boundary-promotion — slice note

Issue: #318 · Status: fixed on this branch, awaiting CI + AC-4 round-12 field proof · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #318 | [FIX-318-surface-boundary-promotion] stage-5 boundary-hold observations (SURFACE-001/003/008) no longer poison the sticky run outcome — recorded as blocked diagnostics, exempt from stage blocking like SURFACE-002; genuinely dangerous codes still block | ☑ done (code; AC-4 round 12 pending) |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-25 | **#318 (FIX-318-surface-boundary-promotion) boundary-hold exemptions.** Round-11 field evidence: stage-10 verified 2/2 on the real directus target yet stage-12 promotion SKIPPED — the run outcome was already sticky-blocked by stage-5 diagnostics SURFACE-001 (external link not followed), SURFACE-003 (maxDepth frontier stop), SURFACE-008 (default-deny POST abort). \`diagnosticBlocksStage()\` exempted only UNSUPPORTED-LANGUAGE (stages 1/2) and SURFACE-002 (stage 5); the fixture app happens to emit exactly those, but ANY real target with external links, deeper paths, or protected POSTs emits 001/003/008 — policy-EXPECTED default-deny observations that made promotion structurally impossible. Fix: 001/003/008 join the stage-5 exemption list (they record the containment policy HOLDING, same semantics as 002); they remain in the run record as blocked-severity diagnostics — never dropped, never reworded; genuinely dangerous codes (006 invalid origin, 007 unattested build) and unknown codes keep blocking (unit-pinned at the exported policy boundary; 006/007 cannot reach stage 5 end-to-end because a malformed origin or unattested build blocks at stage 0 first). \`diagnosticBlocksStage\` is now exported for that pin. Red-first: an end-to-end orchestrator run against a purpose-built boundary fixture (external link + depth-2 path + script-issued POST → emits all three codes) with stubbed verified verification failed pre-fix at exactly \`expected 'blocked' to be 'verified'\` — the precise round-11 condition. **Next: DG-12 round 12 under #256 (AC-4: directus reaches stage-12 promotion).** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-318 surface boundary promotion (#318): breadth-discovery boundary observations (external-origin containment, depth-bound frontier stops, default-deny mutation aborts) no longer block the run outcome or promotion — they are recorded as blocked-severity diagnostics exactly as before but join the stage-5 exemption list like form-submit holds, so real targets with external links, deeper paths, or protected POSTs can promote; genuinely dangerous and unknown stage-5 codes still block.
```

## 4. `VERSION` bump required?

no — orchestrator outcome policy correction; no contract or schema change.

## 5. Evidence pointers

- Defect evidence: `docs/evidence/DG-12/directus/runs/directus-dg12-run11/` — stage-10 outcome=verified, runs 2/2 passed, screenshots captured+attested; stage-12 artifact `{promoted: false, reason: 'No verified staged bundle reached promotion'}`; stage-5 diagnostics SURFACE-001/003/008; reported on #256 (round-11 comment).
- Fix: `packages/orchestrator-langgraph/src/orchestrator.ts` — `diagnosticBlocksStage` stage-5 exemption extended to `ARXIC_SURFACE_EXTERNAL_ORIGIN | ARXIC_SURFACE_FRONTIER_STOP | ARXIC_SURFACE_MUTATION_BLOCKED` alongside `ARXIC_SURFACE_FORM_SUBMIT_BLOCKED`; helper exported for the policy-boundary pin.
- Red-first tests: `packages/orchestrator-langgraph/src/__tests__/sad-paths.test.ts` — `'promotes when stage-5 boundary observations are policy-expected holds (#318)'` (own ephemeral fixture server: external link → 001, `/level1→/level2` beyond maxDepth → 003, script-issued POST on the entry page → 008; pre-fix failed at \`expected 'blocked' to be 'verified'\` — the exact round-11 condition; fixture iteration disclosed: the POST script first sat on an unvisited page so 008 never fired); `'keeps stage-5 blocking for non-exempt codes while exempting policy holds (#318)'` (unit pin: 001/003/008/002 exempt, 006/007/unknown block, non-blocked severity never blocks).
- Gates: orchestrator-langgraph 20 files / 205 tests; verifier + cli 23 files / 232 tests; typecheck/lint clean; `format:check` after this note: `All matched files use Prettier code style!`

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                       | Expected disposition                                                                                    | Test                                                                    |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| stage-5 emits 001/003/008, later stage verifies                               | outcome verified; promotion reached; diagnostics retained (observed, end-to-end)                        | `promotes when stage-5 boundary observations are policy-expected holds` |
| stage-5 emits a genuinely dangerous blocked code (006/007) or an unknown code | still blocks the stage and the sticky outcome (observed, unit)                                          | `keeps stage-5 blocking for non-exempt codes…`                          |
| non-blocked severity diagnostic                                               | never blocks (observed, unit)                                                                           | same                                                                    |
| boundary diagnostics recorded                                                 | still present in \`result.diagnostics\` with original severity/wording (observed, end-to-end assertion) | same promote test                                                       |

## 7. Not done / known-weak spots

- AC-4 (a directus campaign round reaching stage-12 promotion) executes as round 12 under #256 after this merges.
- The exemption list is code-by-code, not semantic-class-by-class: a future SURFACE-0XX that records a policy hold must be added explicitly (deliberate — each exemption is a reviewed decision, and the unknown-code default stays blocking).
- Round 12 may still surface post-promotion seams (receipt/ledger/provenance on the worker-less local lane); the campaign treats each as a new finding, same as this one.
