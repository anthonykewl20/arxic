# FIX-324b-repass-instruction — slice note

Issue: #324 (follow-up to PR #326) · Status: fixed on this branch, awaiting CI + AC-4 round-22 re-measurement · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (append)

```
| #324b | [FIX-324b-repass-instruction] coverage re-pass messages name the pass and require per-row accounting (resemblance is not a skip reason) — koel round 21's declined /rest/* family becomes groundable | ☑ done (code; round 22 re-measurement pending) |
```

## 2. `docs/SYNC.md` — session-log row (append)

```
| 2026-08-25 | **#324b (FIX-324b-repass-instruction).** Koel round 21 measured the residual: 54 unproposed rows = 51 `/rest/*` Subsonic near-clones + 3 scattered — the model declines a near-duplicate family as one implicit intent; dedupe dropped 0; deterministic-truncation hypothesis TESTED AND DISPROVED (a red test for shrinking re-pass batches passed pre-fix — shrinking batches self-converge under deterministic truncation — so that speculative fix was NOT shipped; the disproving test was removed with the hypothesis documented here). Fix: `buildProposalMessages` gains `coveragePass` — re-pass messages open with `RE-PROPOSAL PASS n: every row above received no proposal in earlier passes… do not skip rows because they resemble each other; each is a distinct accounting row` (content-is-data discipline unchanged: the inventory rides the same untrusted-data block). Red-first: `declines-family` stub (proposes rows except `/api/rest/*` UNLESS the message carries the re-pass instruction) — pre-fix the family stayed unproposed; post-fix all rows ground through the same gates. **Directus arithmetic recorded: round 20 grounded ALL 82 extractable rows (82/105 = 78.10%); the 23 ungrounded are diagnostic accounting rows — directus CANNOT reach 80% under the frozen denominator; owner decision (threshold tune before re-measurement, or inventory redesign) required — recorded on #256.** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-324b re-pass instruction (#324): IntentProposer coverage re-pass messages explicitly name the pass and require per-row accounting, so the model no longer declines near-duplicate route families wholesale (measured: 51 of 54 unproposed koel rows were /rest/* Subsonic clones); binding, dedupe, and fail-closed gates unchanged.
```

## 4. `VERSION` bump required?

no — prompt-text change on the re-proposal path plus one optional builder parameter; no contract or schema change.

## 5. Evidence pointers

- Defect evidence: `docs/evidence/DG-12/koel/runs/koel-dg12-run21/intents.json` + stage-4 artifact — 54 ROW-UNPROPOSED records (dedupe {0,0}, coveragePasses 3); classification: 51×`/rest/*`, 3 scattered API routes.
- Disproved hypothesis (documented, not shipped): deterministic output truncation — a red test for shrinking re-pass batches PASSED pre-fix (same-size batches self-converge under deterministic truncation), so batch-shrinking was speculative and was dropped; the test was removed with the reasoning recorded here and in the session log.
- Fix: `packages/orchestrator-langgraph/src/intent-proposer.ts` — `buildProposalMessages(rows, attempt, { coveragePass })`; the coverage-pass loop threads `pass`; first-pass messages unchanged.
- Red-first test: `packages/orchestrator-langgraph/src/__tests__/intent-proposer.test.ts` — 'coverage re-pass requests name unproposed rows so declined families still ground (#324)' with the `declines-family` stub (RED pre-fix: the 3 `/api/rest/*` rows stayed unproposed through every pass).
- Gates: orchestrator-langgraph + intent 31 files / 357 tests; typecheck/lint clean; `format:check` after this note: `All matched files use Prettier code style!`

## 6. Sad paths proved (charter §4)

| Trigger                                                        | Expected disposition                                                                                                                             | Test                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| model declines a near-duplicate route family on the first pass | re-pass instruction names the pass + per-row duty; family grounds through the same gates (observed, unit)                                        | 'coverage re-pass requests name unproposed rows…'                       |
| re-pass still declines                                         | bounded passes end; every remaining row keeps its explicit ROW-UNPROPOSED record (observed, unit — existing #324 test with maxCoveragePasses: 0) | unchanged from PR #326                                                  |
| injection in re-pass instruction context                       | content-is-data classification unchanged (blocked, unit)                                                                                         | existing injection test (message-shape change does not alter the gates) |

## 7. Not done / known-weak spots

- AC-4 verdict pending round 22 (koel re-measurement). Even at koel ≥80%, **directus cannot pass criterion 2 under the frozen denominator** (78.10% = 100% of extractable rows; 23/105 rows are diagnostic accounting) — the owner decision (threshold tune BEFORE a re-measurement per ADR-008, or an inventory-design change so diagnostic subjects are not business-intent rows) is recorded on #256 and NOT taken here.
- The instruction raises re-pass token cost slightly (longer system content); budget estimate already conservative (×(1+passes)).
- The `declines-family` stub idealizes model behavior (deterministic rule vs. the real model's fuzzy family judgment); round 22 is the honest measurement.
