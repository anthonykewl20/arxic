# WEB-402-ROW-HISTORY — staged doc updates (charter §10.2)

Issue: #402 · Disposition: observed implementation (local green; CI and PR pending — GitHub write access for the runner identity is revoked, HTTP 403; an LLM cannot assign `verified`).

## 1. `docs/SYNC.md` — session-log row (append to the table)

```text
| 2026-09-08 | **#402 (WEB-402-ROW-HISTORY) per-row execution history unions every campaign, and recurring fires honor the selection.** `store.rowRuns(projectId, inventoryRowId)` queries the row's executions directly by `workflowScope` (deliberately not the 200-capped run list, so multi-week recurring histories stay complete); `campaignView()` gains an optional `historyOf` seam that stamps each workflow entry with a row-level `history` using the same outcome buckets as the campaign view ({executions, verified, contradicted, blocked, uncovered, pending}); `workbench.campaign()` binds it per project, so ANY campaign's view of a row unions every prior execution across all of the project's campaigns — not just its own run — and the campaign panel's row line reads "N verified of K executions on this surface". Real-world proof: real Workbench + real `makeRepository('reference-auth-app')` discovery + real engine runs, original campaign plus two recurring fires (campaign-row-history.real-world.test.ts, red first: `history` undefined; then a second red stage exposing a fire-selection defect — see below). **Defect fixed (found by this slice's red):** recurring fires executed EVERY eligible discovery row instead of the campaign's selected rows (workbench fire path filtered on `inventoryRowId` only), contradicting the merged #468 documents ("each slot re-executes the selected rows"); a 1-selected-row campaign fired 7 runs per slot — cost and queue-capacity multiplier. Fires now execute only selected rows; the #468 recurrence journey stays green unchanged. **Test-side determinism fix (no assertion widened):** under a contended box the drift journey failed twice ("expected 2 campaigns, got 3") because the Workbench's 1s background tick legitimately fired the `*/1` slot mid-idle; both recurring journeys now arm with `0 0 1 1 *` (background-unreachable) and drive fires with explicit `tick()` calls — coalescing still proven by a double tick; implementation untouched. Gates local: apps/web typecheck ☑ · eslint ☑ · slice test 1/1 ×3 + campaign/workspace regression 19/19 ×2 (loaded) ☑ · full-repo format ☑ (after note); CI NOT run — push still HTTP 403, branch staged locally on `recurring-drift-402`. |
```

## 2. `CHANGELOG.md` — entries under `## [Unreleased]`

```text
### added
- WEB-402-ROW-HISTORY per-row execution history (#402): every campaign workflow row now carries a row-level history ({executions, verified, contradicted, blocked, uncovered, pending}) unioned across all of the project's campaigns — queried directly from run workflow scopes, not the 200-capped run list — so a recurring campaign's view of a surface shows its complete multi-week record at a glance; the campaign panel renders "N verified of K executions on this surface" per row.

### fixed
- WEB-402-ROW-HISTORY recurring fires honor the campaign's selected rows (#402): a recurring fire re-executed every eligible discovery row instead of the rows selected when the campaign was created (a 1-row selection fired 7 runs per slot); fires now re-execute exactly the selected rows, matching the documented recurring-campaign semantics.
```

## 3. `VERSION` bump required?

No — the fold integrator owns `VERSION`; both changes ride the current `0.0.301` line.

## 4. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/campaign-row-history.real-world.test.ts` — real reference-app discovery, real engine runs, original campaign + two recurring fires; asserts the union (executions 3, bucket sum 3, verified count matches the store), bucket parity with the campaign view, and that a fired campaign's view of the row shows the same union.
- Defect red: the fire-selection defect surfaced as this test's second red stage (`expected 2 to be 3` — the fired campaign's first workflow was an unselected row with 2 executions from two fires).
- Test-side race record: `campaign-recurrence.real-world.test.ts` drift journey failed twice under a contended regression batch and passed in isolation with identical code; instrumented probe confirmed legitimate background-tick fires. Deterministic arming disclosed in `docs/evidence/WEB-402-ROW-HISTORY/green.txt` §5.
- Artifacts: `docs/evidence/WEB-402-ROW-HISTORY/red.txt` (first red stage) + `green.txt` (both red stages, 3× slice-test green, 19/19 regression ×2, gate outputs).
- Gates: typecheck ☑ · lint ☑ · test (slice 1/1 ×3, regression 19/19 ×2) ☑ · format ☑ (full repo, run after this note) · license gate → CI (blocked by the 403 push refusal).

## 5. Sad paths / boundaries proved (truth states, charter §4)

| Trigger                                                         | Expected disposition                                                                                           | Status    |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------- |
| Row executed by multiple campaigns (original + recurring fires) | Every campaign's view of that row shows the full union history, not just its own run                           | observed  |
| >200 total runs in the store                                    | Row history stays complete (direct SQL by `workflowScope`, not the 200-capped list)                            | by design |
| Rows with no executions yet                                     | No `history` field (workflow entries without an inventory row id never get one)                                | observed  |
| Recurring fire with unselected discovery rows                   | Fire executes ONLY the selected rows (defect fixed; was all eligible rows)                                     | observed  |
| Campaign view bucket parity                                     | `rowHistoryOf` uses the exact bucket logic of `campaignView` (pending/verified/contradicted/uncovered/blocked) | by design |
| Contended machine during recurring journeys                     | Background ticker cannot fire a `0 0 1 1 *` slot mid-test; journeys are explicit-tick deterministic            | observed  |

## 6. Disclosures

- The fire-selection fix changes merged #468 behavior to match #468's own documentation; the merged recurrence journey passes unchanged (its `fired.runIds.length > 0` assertion never pinned composition — that gap is why the defect survived).
- The drift + row-history journeys now arm with a yearly cron instead of `*/1 * * * *`; the re-fire journey keeps its documented background-coalescing design (theoretical exposure only if a single engine run exceeds one minute on an uncontended runner — not observed in CI).
- CI has not run: push returns HTTP 403 (runner write access revoked mid-relay). Branch staged locally at `.worktrees/recurring-drift-402`, two commits ahead of `origin/main` (drift slice `f26f6eeb`, this slice).
