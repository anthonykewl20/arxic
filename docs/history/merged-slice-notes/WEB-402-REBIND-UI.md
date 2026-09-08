# WEB-402-REBIND-UI — staged doc updates (charter §10.2)

Issue: #402 · Disposition: observed implementation (local green ×2 with the badge observed live in real Chromium; CI on the PR head is the remaining gate — an LLM cannot assign `verified`).

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

Supersedes the WEB-402-DRIFT-REBIND row if it is still pending fold.

```text
| #402 | Web product release: comprehensive frontend intent campaigns and AI visual auditing | In progress; the rebinding state is surfaced: a drifted recurring campaign whose rebind discovery is in flight shows an explicit 'Rebinding' campaign state plus a card badge carrying the discovery run's live state, clearing when the rebind lands; a disarmed recurring schedule (exhausted/failed rebind, drift stop) reads as the stopped state it is |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```text
| 2026-09-08 | **#402 (WEB-402-REBIND-UI) the rebinding state is surfaced on the campaigns panel.** The UI follow-up recorded as owed by #484: `campaignView` gains a display-only `'rebinding'` state — when `campaign.rebinding.discoveryRunId` is set the view reports `rebinding` ahead of the run-derived buckets, with `cancelled` keeping precedence; the raw marker already flows through `/state` and `/campaigns/:id` JSON, so no payload changed and no endpoint was added (pure surfacing; the #484 rebind machinery is untouched). The React campaign card and detail card render a `data-rebinding="true"` badge reading "Rebinding — discovery run <state>" with the discovery run's live state from the already-loaded run summaries (unknown run id renders plain "Rebinding" without inventing a state); the badge clears when the rebind lands and the panel then shows the fresh `sourceCommit`. A disarmed recurring schedule (`cron` set, `nextFireAt` null, not rebinding — the exhausted/failed-rebind and drift-stop outcomes) now derives to `blocked` instead of masquerading as `completed`; armed schedules and one-shot campaigns are unaffected. Real-world proof: `campaign-rebind-ui.real-world.test.ts` — real workbench, real reference-auth-app checkout, REAL `git` drift commit, explicit pre-fire guard, then a real PROCESS HANDOFF: a queued agent-run backlog holds the drain so the rebind discovery stays QUEUED at `wb.close()` and the real server (`startWorkbench`, port 0) drains the backlog, runs the discovery and lands the rebind while real Chromium watches the campaigns view — the badge was observed LIVE ("Rebinding — discovery run queued"), then clearing, with the detail showing the new commit and zero page errors; second journey proves the exhausted-selection stop shows no badge and a `blocked` (stopped) panel. Red first (unit: `rebinding` state + disarmed-schedule `blocked` derivation failed pre-implementation; journey: `wb.campaign().state` was not `rebinding`). Regressions: campaign-ui 1/1, campaign-drift-rebind 4/4, campaign-drift-revalidate 3/3, campaign-recurrence 3/3, campaign-row-history 1/1, inventory-ledger-ui 1/1, workspace 5/5, campaigns unit 10/10. Gates local: apps/web typecheck ☑ · repo eslint ☑ · format ☑ (full repo after note). Known gaps (recorded, not hidden): the exhausted-selection browser journey is green pre-implementation in this environment because the campaign's own child runs end blocked without a live model, so the discriminating red for the stopped presentation is the unit case; the badge's live observation depends on the handoff backlog window (both local runs observed it; if a window is ever missed the journey asserts the cleared state and records the miss). |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```text
- WEB-402-REBIND-UI rebinding state surfaced on the campaigns panel (#402): a drifted recurring campaign whose rebind discovery is in flight shows an explicit 'Rebinding' state and a card badge carrying the discovery run's live state, clearing when the rebind lands; a disarmed recurring schedule (exhausted/failed rebind, drift stop) reads as stopped instead of completed; display-only derivation over existing payloads — no new endpoints, no rebind-machinery changes; proven in real Chromium across a real workbench→server handoff of the queued rebind discovery.
```

## 4. `VERSION` bump required?

No — the fold integrator owns `VERSION`; the capability rides the current `0.0.301` line.

## 5. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/campaign-rebind-ui.real-world.test.ts` — real workbench + real reference-auth-app fixture, real `git` drift, real pre-fire guard, real server over the same state directory draining the handed-off queued discovery, real Chromium campaigns view; `ARXIC_MAILPIT_*` unset, port 0.
- Artifacts: `docs/evidence/WEB-402-REBIND-UI/red.txt` (pre-implementation unit + journey failures) + `green.txt` (green ×2, both runs recording the live badge observation `"Rebinding — discovery run queued"`).
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (slice 10/10 unit + 2/2 journey ×2, siblings 18/18) ☑ · license gate → CI.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                        | Expected disposition                                                                           | Test                                                                                        |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Rebind discovery in flight (`rebinding` set)                                   | View state `rebinding`; badge `Rebinding — discovery run <state>` on card + detail             | campaigns.test.ts unit + journey test 1 (badge observed live)                               |
| Campaign cancelled while a rebind is in flight                                 | `cancelled` keeps precedence; no rebinding state                                               | campaigns.test.ts cancelled-precedence unit                                                 |
| Rebind lands (discovery completes)                                             | Badge clears; panel shows the fresh `sourceCommit`; state leaves `rebinding`                   | journey test 1 cleared-state assertions                                                     |
| Discovery run id not among loaded summaries                                    | Badge reads plain `Rebinding` — no invented state                                              | campaign-panel.tsx `RebindingBadge` branch (code path; live run found in both journey runs) |
| Exhausted/failed rebind stops the schedule (`nextFireAt` null, marker cleared) | Stopped presentation: view state `blocked`, no badge, detail without "Rebinding"               | journey test 2 + campaigns.test.ts disarmed-schedule unit                                   |
| Armed recurring schedule / one-shot campaign                                   | Unaffected: no stopped presentation (`completed`/run-derived)                                  | campaigns.test.ts armed + one-shot unit cases                                               |
| Campaign fires while rebinding (doomed fire attempt)                           | Zero new row-scoped runs at the due slot                                                       | journey 1 & 2 `wb.tick(slot2)` zero-doomed assertions                                       |
| View-state consumers stay exhaustive                                           | Only the pill class/text consumes the state; no switch existed; type flows from `campaignView` | repo typecheck + eslint + workspace/campaign-ui suites                                      |
