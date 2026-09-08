# WEB-402-LEDGER-PANEL — staged doc updates (charter §10.2)

Issue: #402 · Disposition: observed implementation (local green ×3; CI on the PR head is the remaining gate — an LLM cannot assign `verified`).

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```text
| #402 | Web product release: comprehensive frontend intent campaigns and AI visual auditing | In progress; per-row execution ledger — the inventory view unions every campaign execution per surface row and says so explicitly for rows no campaign selected |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```text
| 2026-09-08 | **#402 (WEB-402-LEDGER-PANEL) cross-campaign execution ledger on inventory rows landed.** The inventory view gains an EXECUTION LEDGER column: each surface row shows "N verified of M executions across campaigns" (contradicted/blocked counts appended when nonzero), unioned across the original campaign AND every recurring fire — and a row no campaign ever selected says "Not selected for a campaign yet." explicitly instead of rendering blank. Layering: the workbench owns the identity join (`rowOutcomes()` maps runs to surface keys via campaign rows, which carry both the projection `inventoryRowId` and the human `METHOD path` key) and emits `outcomes` in the `/state` snapshot; the React panel only renders the ledger — no mapping logic duplicated in the frontend. A dedicated uncapped `scopedRuns` query keeps multi-week recurring histories complete where the 200-capped run list would truncate them. Real-world proof: `inventory-ledger-ui.real-world.test.ts` runs a REAL discovery against the real reference-auth-app checkout, enqueues a real campaign on one row with a yearly cron, drives two real cron fires by explicit tick (3 executions of the selected row, 0 of the rest), then drives the real dashboard: the executed row's ledger reads "…verified of 3 executions across campaigns" and an unselected row reads "Not selected for a campaign yet." — zero page errors. Red first (`wb.rowOutcomes is not a function`). Regressions: campaign-ui, workspace, review-loop and ui real-browser suites 9/9. Gates local: apps/web typecheck ☑ · repo eslint ☑ · format ☑ (full repo after note); CI on the PR head is the remaining gate. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```text
- WEB-402-LEDGER-PANEL per-row execution ledger (#402): the inventory view gains an EXECUTION LEDGER column that unions every campaign execution per surface row — verified of executions across campaigns, with contradicted and blocked counts when present — and states plainly when a row has never been selected by a campaign; the workbench joins runs to surface keys server-side through campaign rows and ships the result in the state snapshot.
```

## 4. `VERSION` bump required?

No — the fold integrator owns `VERSION`; the capability rides the current `0.0.301` line.

## 5. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/inventory-ledger-ui.real-world.test.ts` — real discovery over the real reference-auth-app fixture, real campaign + two real cron fires via explicit tick, real Playwright-driven dashboard over the live workbench server.
- Artifacts: `docs/evidence/WEB-402-LEDGER-PANEL/red.txt` (first red: `wb.rowOutcomes is not a function` after the harness proved 3 real executions) + `green.txt` (3× slice green, 9/9 sibling regressions, gate outputs).
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (slice 1/1 ×3, siblings 9/9) ☑ · license gate → CI.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                        | Expected disposition                                                    | Test                                               |
| ---------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| Discovery row no campaign ever selected        | Cell says "Not selected for a campaign yet." — explicit, never blank    | journey unselected-row assertion                   |
| Row executed by original campaign + cron fires | Ledger unions ALL executions ("3 executions"), not just the latest fire | journey 3-execution store + text assertions        |
| Runs of other rows or non-campaign runs        | Excluded — the join keys on campaign-row identity, not the raw run list | journey: executed vs unselected contrast           |
| Run list longer than the 200-run summary cap   | Uncapped `scopedRuns` query keeps the full per-row history              | `store.scopedRuns` (no LIMIT, json_extract filter) |
| Page errors while rendering the ledger column  | none collected                                                          | journey `errors` assertion                         |
| Ledger seam absent (pre-implementation)        | Journey red: `wb.rowOutcomes is not a function`                         | `red.txt`                                          |
