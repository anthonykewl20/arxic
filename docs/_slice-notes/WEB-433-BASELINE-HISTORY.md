# WEB-433-BASELINE-HISTORY — staged doc updates (charter §10.2)

Issue: #433 · PR: linked from issue #433 · Disposition: local validation in progress; completion requires current-head CI-gated merge.

## 1. `docs/SYNC.md` — tracker row

```
| #433 | [WEB-433-BASELINE-HISTORY] Historical comparison versus current baseline approval | Complete only after required CI-gated merge |
```

## 2. `docs/SYNC.md` — session-log row

```
| 2026-09-07 | **#433 (WEB-433-BASELINE-HISTORY)** Dashboard labels immutable comparison-at-capture-time status separately from current baseline approval; absent baseline/difference images explain the historical reason. Real Chromium/reference-app journeys cover approval failure/retry, replacement, revisiting history and unchanged original results/bytes. Next: remaining #402 runtime, state/heuristic and release gates. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- WEB-433-BASELINE-HISTORY (refs #433): distinguish a capture's historical comparison from current baseline approval, including explicit reasons for absent baseline/difference images. Approval and replacement preserve previous results and image references while updating future comparisons.
```

## 4. `VERSION` bump required?

Yes, user-visible fix; integrator applies the owner's patch policy in merge order.
No worktree SYNC/CHANGELOG/VERSION edits.

## 5. Evidence pointers

- `apps/web/src/__tests__/baseline-history-ui.real-world.test.ts`: actual vulnerable
  auth reference app, Chromium, persisted visual captures, authenticated dashboard
  approval via keyboard, failure/retry, three captures, replacement and history.
- Independent literal API result snapshots and original PNG bytes must remain equal
  after approval/replacement. Historical comparison image references remain exact.
- Initial light/dark journeys: 2 tests passed in 21.09 s. Expanded mobile proof,
  regression suites and current-head CI are pending at this note's initial revision.
- No raw traces, human screenshot sign-off or full browser/state/heuristic claim.

## 6. Sad paths proved

| Trigger                                 | Expected disposition                                                  | Test                                           |
| --------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------- |
| Approval endpoint unavailable           | Visible failure, retry remains possible; no current approval badge    | Actual Chromium + HTTP boundary                |
| First capture has no baseline           | Explain historical absence; do not invent comparison pixels           | Actual reference-app capture                   |
| Approval succeeds after first capture   | Current badge and historical no-baseline state remain distinct        | Actual Chromium and exact API result           |
| Later capture replaces current baseline | Future run uses replacement; old comparison retains original source   | Three actual captures and API/image assertions |
| Revisit formerly current first capture  | No current approval badge; immutable history and image bytes retained | Actual browser, API and bytes                  |

The intended copy assertion failed before implementation. An earlier setup attempt
navigated before login; the login reset cleared that selection, so the test now
opens its recorded run after authentication. No product assertion was loosened.
The existing retention test now waits for the explicit current-approval badge
instead of the former ambiguous figure caption; it still requires exact image bytes.
This changes presentation only; Actions/Service policy and truth contracts are unchanged.
