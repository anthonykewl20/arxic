# WEB-402-REBIND-COUNTS — staged doc updates (charter §10.2)

Issue: #402 · Disposition: observed implementation (local green — real rebind journeys against a real reference-auth-app checkout with real `git` drift, plus the detail card asserted in real Chromium across a real workbench→server handoff; CI on the PR head is the remaining gate — an LLM cannot assign `verified`).

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

No `| #402 |` row exists in the current milestone tracker (the #486/#487 fold folded #402 status into the RESUME paragraph). Staged status text for the integrator to fold there:

```text
| #402 | Web product release: comprehensive frontend intent campaigns and AI visual auditing | In progress; rebind outcomes are now data: a landed rebind records `rebound { survivors, dropped, at }` on the campaign record inside the remap transaction (stop paths stay field-free; any later rebind overwrites it) and the campaign detail card renders "Rebound — carried over N of M selected, dropped D" with a `data-rebound="N/D"` attribute |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```text
| 2026-09-09 | **#402 (WEB-402-REBIND-COUNTS) rebind survivor/dropped counts recorded on campaign records and surfaced on the detail card.** The follow-up recorded in SYNC since #484 ("aggregate survivor/dropped audit counts"): when a drifted recurring campaign's rebind lands, the remap transaction now stamps the outcome as data — `Campaign.rebound?: { survivors, dropped, at }` (additive JSON, no migration, no new endpoints) is computed in `rebindCampaign`'s existing `store.db.transaction` block from the already-derived `survivors`/`survivorIds`/`selected` (`survivors: survivors.length`, `dropped: selected.size - survivorIds.size`, `at: new Date().toISOString()`; `survivorIds` was hoisted above the transaction so the literal and the existing per-row drop audits share one computation). The field is overwritten by any later rebind (latest outcome wins), survives until campaign deletion, and is deliberately NOT set on stop paths — `stopRebind` (exhausted/failed/dirty) is untouched, so an absent field still means "no rebind ever landed". The campaign DETAIL card (not the grid card) renders, when the field is present, `Rebound — carried over {survivors} of {survivors+dropped} selected, dropped {dropped}` on a `data-rebound="{survivors}/{dropped}"` element; the optional field is narrowed into a local `const rebound = campaign.rebound` inside an IIFE before JSX (inline optional-chained property access in JSX ternaries trips TS2322 narrowing here — learned in #482 and honored). Real-world proof (red first): `campaign-drift-rebind.real-world.test.ts` — the happy-path journey (full survival) FRESH-reads `wb.store.campaign(id)` after the rebind and asserts `rebound` defined with `survivors` = the scenario's selected-row count (1) and `dropped` 0; the partial-survival journey (FORGOT removed by a real file-removal commit) fresh-reads exactly `survivors: 1, dropped: 1`; the rebind-exhausted journey asserts the stopped campaign's `rebound` is `undefined` (stop paths stay field-free). `campaign-rebind-ui.real-world.test.ts` — in the live-handoff journey (badge cleared, new sourceCommit shown in real Chromium), the detail card additionally shows `[data-rebound]` = "1/0" with "carried over" and "dropped" text; zero page errors assertion unchanged. Red verbatim: `expected undefined to be defined` at both fresh-read assertions and `expected +0 to be 1` on the `[data-rebound]` locator count pre-implementation. Regressions: campaign-drift-revalidate 3/3, campaign-ui 1/1, workspace 5/5, campaigns unit — 19/19 across the four suites. Gates local: apps/web typecheck ☑ · repo eslint ☑ · format ☑ (full repo after note). Known gaps (recorded, not hidden): the counts are a latest-outcome snapshot, not a per-rebind history (only the audit log carries per-event records); `at` is not rendered in the UI; the grid card intentionally stays unchanged; the rebind-failed stop journey keeps its existing assertions only (its field-free property is pinned by the exhausted journey's negative assertion, which is the same `stopRebind` code path). |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```text
- WEB-402-REBIND-COUNTS rebind outcome counts on campaign records (#402): a landed drift rebind stamps `rebound { survivors, dropped, at }` on the campaign record inside the remap transaction — survivors re-acquired per-row executions on the new commit, dropped selections were audited per row, overwritten by any later rebind, absent on exhausted/failed stop paths — and the campaign detail card renders "Rebound — carried over N of M selected, dropped D" with a `data-rebound="N/D"` attribute; proven with real git-drift rebind journeys (full survival, partial survival, exhausted stop) and asserted live in real Chromium.
```

## 4. `VERSION` bump required?

No — the fold integrator owns `VERSION`; the capability rides the current `0.0.301` line.

## 5. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/campaign-drift-rebind.real-world.test.ts` — real Workbench, real reference-auth-app checkout, real discovery, real yearly-cron campaign, REAL `git` drift commits (append keeps the selection → full survival; file removal drops a route → partial; login-page removal → exhausted stop), fresh store reads asserting the recorded counts.
- Real-world proof: `apps/web/src/__tests__/campaign-rebind-ui.real-world.test.ts` — real workbench→server process handoff of the queued rebind discovery; real Chromium watches the badge clear, the new sourceCommit land, and the `data-rebound` line render; zero page errors.
- Artifacts: `docs/evidence/WEB-402-REBIND-COUNTS/red.txt` (pre-implementation failures, verbatim) + `green.txt` (post-implementation green).
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (slice journeys 6/6; regressions 19/19) ☑ · license gate → CI.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                            | Expected disposition                                                                                                    | Test                                                             |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Rebind lands (drifted commit keeps the selection)  | `rebound` recorded on a FRESH store read: survivors = selected count, dropped 0, ISO `at`                               | `campaign-drift-rebind.real-world.test.ts` happy journey         |
| Partial survival (one selected route file removed) | Exact counts recorded: survivors 1, dropped 1 — the aggregate matches the per-row drop audit                            | `campaign-drift-rebind.real-world.test.ts` partial journey       |
| Exhausted selection (whole selection gone)         | Campaign stopped, `rebound` `undefined` — stop paths never fabricate an outcome                                         | `campaign-drift-rebind.real-world.test.ts` exhausted journey     |
| Second rebind over a recorded outcome              | Latest outcome wins (the literal overwrites the field; recorded as design, not separately journeyed — see known gaps)   | Design note §1/§2                                                |
| Detail card with `rebound` present                 | `data-rebound="1/0"` line renders "carried over … dropped …" in real Chromium across the live handoff; zero page errors | `campaign-rebind-ui.real-world.test.ts` handoff journey          |
| Detail card with `rebound` absent (never re-bound) | No line renders (conditional render; grid card unchanged)                                                               | Implicit in the conditional; pinned by the card's existing tests |
