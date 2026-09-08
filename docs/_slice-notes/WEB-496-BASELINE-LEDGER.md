# WEB-496-BASELINE-LEDGER — staged doc updates (charter §10.2)

Issue: #496 · PR: (filled at PR creation) · Disposition: verified (deterministic store/action tests + real-browser journey; see boundaries)

## 1. `docs/SYNC.md` — tracker row (no numbered tracker table applies; #496 lives on the issues board under #402's scope. Suggested RESUME-note sentence instead)

```
The baseline approval ledger (#496) landed: every approval is an immutable, attributable row, superseded baseline runs are deletion-protected, and legacy pre-ledger pointers are labeled honestly.
```

## 2. `docs/SYNC.md` — session-log row (append)

```
| 2026-09-08 | **#496 (WEB-496-BASELINE-LEDGER) immutable baseline approval ledger DONE.** `baseline_approvals` append-only ledger (approver, UTC time, capture SHA-256, supersedes chain) committed with the pointer upsert + audit event in one transaction; `baseline_refs` now unions the ledger so deletion/retention protect superseded baseline runs; `baselineApprovals` state projection labels pre-ledger pointers `legacy` without fabricated approver/timestamp (the marker is replaced by the first attributable approval, which then ends the legacy run's deletion protection — disclosed behavior change). 5/5 unit tests (incl. concurrent-approval serialization) + real Chromium journey in visual.test.ts prove approve → supersede → history → delete-refusal; integrity gates stay fail-closed (tampered/unstable/non-completed → 409, ledger stays empty). Next: branch/Git-aware baseline resolution on top of the ledger; actor identity beyond the single administrator. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- WEB-496-BASELINE-LEDGER Immutable baseline approval ledger (#496): every baseline approval now appends an immutable record (administrator approver, UTC timestamp, approved capture SHA-256, supersession chain) in the same transaction as the pointer update; the workbench state exposes the approval history (`baselineApprovals`) with honest `legacy` labels for pre-ledger pointers; runs referenced by any approval — current or superseded — are refused by manual and automatic deletion. Real-browser journey and concurrent-approval tests back the behavior.
```

## 4. VERSION bump required?

yes → 0.0.302, because the change is user-observable (new approval-history state data + stronger deletion protection; `baselineApprovals` in the dashboard API response).

## 5. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/visual.test.ts` — real fixture app (vulnerable-auth-app) driven by real Chromium through the workbench; the journey now includes approve → supersede → ledger history → refusal to delete the superseded baseline run.
- Unit/action proof: `apps/web/src/__tests__/baseline-approvals.test.ts` — 5/5, including concurrent approvals serialized into one pointer with a linear `supersedes` chain, legacy-pointer labeling, and fail-closed integrity gates with an empty ledger.
- Artifacts: none retained beyond the test suite output (no screenshots required for a store/governance slice; the UI is unchanged in this slice).
- Gates: typecheck ☐ · lint ☐ · format ☐ · test (see PR) ☐ · license gate ☐ (CI)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                | Expected disposition                                                   | Test                                                                                                              |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Approve capture whose on-disk bytes no longer hash to `capture.sha256` | fail-closed 409 `Capture integrity check failed`; ledger unchanged     | baseline-approvals.test.ts (refused approvals keep the ledger empty) + pre-existing visual.test.ts tamper journey |
| Approve an `unstable` capture or a non-completed run                   | fail-closed 409 `Only a completed, stable capture`; ledger unchanged   | baseline-approvals.test.ts                                                                                        |
| Delete a run referenced only by a superseded approval                  | fail-closed 409 `approved baselines` (run preserved)                   | baseline-approvals.test.ts + visual.test.ts real journey                                                          |
| Concurrent approvals of the same spec                                  | serialized: exactly one pointer, linear supersedes chain, no lost rows | baseline-approvals.test.ts (Promise.all through the mutate queue)                                                 |
| Pre-ledger pointer rows at migration                                   | exposed as `legacy` without fabricated approver/timestamp              | baseline-approvals.test.ts                                                                                        |
