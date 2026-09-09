# WEB-402-CLEAN-INSTALL-LIVE — staged doc updates (charter §10.2)

Issue: #546 · PR: #548 · Disposition: observed (engine-assigned `verified`)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #546 | [WEB-402-CLEAN-INSTALL-LIVE] Clean-install current-head campaign acceptance | ☑ done — owner-authorized live run, outcome `verified` |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

Row `2026-09-09 (14)`, folded in this PR.

## 3. `CHANGELOG.md` — entry under `## [Unreleased]`

Folded in this PR: `WEB-402-CLEAN-INSTALL-LIVE clean-install fresh live-provider campaign acceptance (#546)`.

## 4. `VERSION` bump required?

no — a proof runner plus evidence and documentation. No product code changed and
no user-observable behavior differs.

## 5. Evidence pointers

- Real-world proof: `scripts/clean-install-live-campaign.mts` — packed tarball,
  clean-room install, real `reference-auth-app`, real engine, live GLM provider.
- Retained: `docs/evidence/WEB-402-CLEAN-INSTALL-LIVE/summary.md`,
  `campaign-record.json`, `campaign-record.sanitization.json`.
- Outcome: `result.outcome: "verified"`; `ledger.verification`
  `{"outcome":"verified","passedRuns":2,"runs":2}`; 13 stages completed, 8 gates
  passed.
- Gates: typecheck ☑ · typecheck:packages ☑ · lint ☑ · format ☑ · test ☑ ·
  license gate ☑ (required CI)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                      | Expected disposition                                                                                                                             | Test                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Campaign launched with **no** provider credential configured | `blocked`/`blocked`, stage 5 fails closed; a credential-less `verified` is asserted to be a failure of the proof                                 | `scripts/clean-install-live-campaign.mts` (sad path runs first, on the same discovery) |
| Non-GET request without a same-origin `Origin` header        | server refuses `403 Same-origin request required` (`server.ts:85-87`) — found by the runner's own red; the client was corrected, not the product | observed during this slice                                                             |
| Clean room without a provisioned browser                     | stage 5 `bounded-discovery` fails closed rather than silently degrading                                                                          | observed during this slice; chromium is now provisioned in-room                        |
| Credential reaching the retained record                      | runner throws before writing if the value survives redaction; independently re-verified afterwards (no value, no 8-char prefix)                  | `scripts/clean-install-live-campaign.mts`                                              |

## 7. What this slice does NOT do

- It is **one row, one campaign** — a path proof, not a coverage claim. Seven
  other extracted rows were not attempted and remain in the ledger.
- `engineArtifacts` is retained as `null`: the installed server's run-directory
  layout differs from the developer workbench's, which is where that path came
  from. The authoritative engine record is embedded in `result.engineRun` and
  `result.ledger`, so nothing is lost; re-running purely to populate a redundant
  field would spend against the funded credential again.
- The `sadPath.kind` label would also read `blocked-at-execution` for a campaign
  that _completed_ with a non-verified outcome. `detail` always carries the true
  `state/outcome` pair.
- It discharges **#546 only**. The human screenshot-inspection gate, the #423
  human review, the remaining paid-provider proofs and every other row in
  `docs/release-gates/undischarged-gates.md` are untouched.
- It is **not** run in CI: it spends against the owner's funded credential and
  must stay owner-invoked.
