# FIX-324-grounded-coverage — slice note

Issue: #324 · Status: Cause A implemented on this branch (iterative coverage passes + explicit unproposed accounting); Causes B/C intentionally deferred (see §7); awaiting CI + AC-4 re-measurement rounds · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #324 | [FIX-324-grounded-coverage] IntentProposer gains bounded re-proposal passes over unproposed rows (default 2, budget-gated ×(1+passes)) + an explicit observed ARXIC-ORCH-PROPOSAL-ROW-UNPROPOSED record per row the model never proposed — no silent non-coverage (ADR-008 Decision 2); Causes B/C deferred with evidence | ☑ done (Cause A; AC-4 re-measurement rounds pending) |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-25 | **#324 (FIX-324-grounded-coverage) Cause A — iterative coverage passes.** Measured grounding: directus 71.43% (75/105), koel 48.57% (153/315) vs the 80% exit criterion; on koel 148 extracted rows received NO proposal and carried a BLANK reason (dedupe dropped 0 — the model simply returned partial coverage per batch). Fix: after the first full batch pass, unproposed rows are re-partitioned and re-proposed through the SAME binding+dedupe gates, bounded by maxCoveragePasses (default 2, 0 = legacy single-pass); the budget estimate conservatively covers the worst case (×(1+passes)); every row still unproposed after the final pass gets an explicit observed-severity ARXIC-ORCH-PROPOSAL-ROW-UNPROPOSED diagnostic (subject row:<id>) — honest non-coverage, never a block; proposalRun records coveragePasses. New diagnostic code registered in the frozen ORCH family. Red-first ×2 with a 3-row single-domain fixture + a partial-coverage stub (first sight of a row-batch proposes only its first row; re-pass batches get full proposals): coverage pass completes the rows (RED pre-fix: rows stayed unproposed); maxCoveragePasses:0 leaves explicit per-row records (RED pre-fix: no records). DISCLOSED test-expectation change: 'honest zero for empty proposal list' now expects 6 requests (2 batches × 3 passes), coveragePasses=3, and 2 ROW-UNPROPOSED diagnostics — the re-asks are the new intended behavior, not retries; fail-closed per-run semantics and the failure-diagnostics passthrough (a refactor initially dropped STRUCTURED-OUTPUT-INVALID from the blocked return — caught by the injection test, fixed) are unchanged. **Causes B (ungroundable rows dispositioned extracted) and C (form-blind inference) deferred with evidence — B cannot move criterion 2 (denominator = ALL ledger rows by the frozen script) and C's criterion-3 effect is expected to ride on Cause A (a re-pass proposes the form-backed `/` row). Next: DG-12 rounds 20/21 re-measure BOTH apps.** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-324 grounded coverage (#324): the IntentProposer runs bounded re-proposal passes over rows the model left unproposed (default 2, budget-gated for the worst case) through the same binding and dedupe gates, and records an explicit observed ARXIC-ORCH-PROPOSAL-ROW-UNPROPOSED diagnostic for every row that ends unproposed — partial model coverage no longer disappears silently (ADR-008 Decision 2); proposalRun reports coveragePasses.
```

## 4. `VERSION` bump required?

no — one new ORCH diagnostic code (additive to the frozen family union), one optional proposer option, one additive proposalRun field; no existing contract change.

## 5. Evidence pointers

- Defect evidence: `docs/evidence/DG-12/koel/runs/koel-dg12-run16/intents.json` — 156 hypothesized / 159 observed rows; the 159 include 148 `extracted` rows with blank reason (no proposal, no record); stage-4 artifact dedupe {0,0}; `scripts/dg12-grounded-ratio.mjs` FAIL directus 71.43% / koel 48.57%.
- Fix: `packages/orchestrator-langgraph/src/intent-proposer.ts` — `runBatches` helper + coverage-pass loop over `unproposedAfter()`; `DEFAULT_MAX_COVERAGE_PASSES = 2`; budget estimate ×(1+passes); per-row observed diagnostics; `coveragePasses` in proposalRun. `packages/orchestrator-langgraph/src/diagnostics.ts` — `ARXIC_ORCH_PROPOSAL_ROW_UNPROPOSED` added to the frozen family.
- Red-first tests: `packages/orchestrator-langgraph/src/__tests__/intent-proposer.test.ts` — 're-proposes unproposed rows in a bounded coverage pass (#324)' and 'records an explicit observed diagnostic for every row left unproposed (#324)' (both RED pre-fix), with the `partial-first-pass` stub (seen-row tracking: a never-seen batch proposes only its first row; any batch containing a previously-seen row is a re-pass) and the `catalogInventory()` 3-row single-domain fixture.
- Gates: orchestrator-langgraph + intent + domain-inventory-spike + verifier + cli + m0-pipeline: 69 files / 718 tests; typecheck/lint clean; `format:check` after this note: `All matched files use Prettier code style!`

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                       | Expected disposition                                                                                                             | Test                                                                                                                                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| model proposes only part of a multi-row batch | coverage passes re-propose the remainder through the same gates until covered or bounded (observed, unit)                        | 're-proposes unproposed rows in a bounded coverage pass (#324)'                                                                                                                                      |
| rows still unproposed after all passes        | one explicit observed record per row (subject row:<id>), run proceeds — honest non-coverage (observed, unit)                     | 'records an explicit observed diagnostic for every row left unproposed (#324)'                                                                                                                       |
| empty model response on every pass            | honest zero candidates + bounded re-asks (6 requests, coveragePasses 3) + per-row records — never a retry storm (observed, unit) | 'returns an honest zero for an empty proposal list without retrying' (updated, disclosed)                                                                                                            |
| batch hard-fails mid-pass                     | fail-closed per run with the underlying failure diagnostics preserved (blocked, unit)                                            | 'blocks after bounded retries…' + 'blocks instruction-like model output…' (regression-caught: a refactor initially dropped the STRUCTURED-OUTPUT-INVALID passthrough — the injection test caught it) |
| budget                                        | worst-case estimate (×(1+passes)) gated BEFORE any call (blocked, unit)                                                          | 'blocks BEFORE any model call when the cost estimate exceeds the budget cap' (multiplied estimate still gated)                                                                                       |

## 7. Not done / known-weak spots

- **Cause B deferred with evidence:** re-dispositioning ungroundable rows (parse-error subjects, scan diagnostics, language placeholders) as `unextracted-with-reason` is honest accounting but CANNOT move criterion 2 — the frozen `dg12-grounded-ratio.mjs` denominator is ALL ledger rows; the rows stay ungrounded either way. Directus arithmetic: ~19 diagnostic rows cap the maximum at ~86/105 = 81.9% vs the 80% bar — tight; if the re-measurement lands below 80 the honest paths are (a) more coverage passes, (b) owner threshold tuning BEFORE a re-measurement (ADR-008-sanctioned, not mine to do), or (c) an inventory-design change so diagnostic subjects are not business-intent rows (a product decision needing its own slice).
- **Cause C deferred with evidence:** form-aware proposal input needs the crawl before inference (a graph reorder) or a post-crawl re-proposal round; Cause A may organically cover its measurable effect (a re-pass proposes koel's form-backed `/` row → criterion 3 non-vacuous). Measured in round 21; if koel still has zero form-backed proposals, C files as its own follow-up.
- The fabrication-audit script gap (criterion 4 manual-only) remains flagged on #256; not addressed in this slice.
- Coverage passes multiply model spend by up to (1+passes) worst case; measured rounds 20/21 will report actual spend against the ledger.
