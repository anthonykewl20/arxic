# WEB-431-RETENTION — staged doc updates (charter §10.2)

Issue: #431 · PR: linked from issue #431 · Disposition: local validation in progress; completion requires current-head CI-gated merge.

## 1. `docs/SYNC.md` — tracker row

```
| #431 | [WEB-431-RETENTION] Protected evidence retention and restart recovery | Complete only after required CI-gated merge |
```

## 2. `docs/SYNC.md` — session-log row

```
| 2026-09-07 | **#431 (WEB-431-RETENTION)** Opt-in age/newest retention with whole-history bounded previews, explicit administrator deletion consent, protected idle cleanup and durable restart recovery. Actual Chromium/reference-app captures and dashboard failure/retry journeys establish the recorded behavior. Partial recovery counts preserve actual deletion results. Next: remaining #402 runtime, state/heuristic and release gates. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- WEB-431-RETENTION (refs #431): manage evidence retention in Administration with disabled-by-default policy, protected whole-history previews, explicit consent, bounded idle cleanup and persistent recovery outcomes. Manual, automatic and restart deletion share baseline/review/campaign protection. Failed cleanup exposes retry guidance and preserves durable intent without claiming success.
```

## 4. `VERSION` bump required?

Yes, user-observable addition; integrator applies the owner's version policy in
merge order. No worktree SYNC/CHANGELOG/VERSION edits.

## 5. Evidence pointers

- `apps/web/src/__tests__/retention-ui.real-world.test.ts`: real Chromium and
  vulnerable-auth-app captures, light/dark desktop/mobile settings, preview,
  consent, storage failure, recovery feedback, retry and preserved baseline bytes.
- `retention.real-world.test.ts`: actual capture cleanup, filesystem failure,
  persisted deletion intent, restart recovery, policy persistence and automatic
  idle cleanup with exact baseline byte preservation.
- `retention.test.ts`, `retention-recovery.test.ts`, `retention-http.test.ts`:
  supplementary policy, HTTP auth/origin, 251-record bounded-history and partial
  recovery boundaries. These do not substitute for real capture proof.
- Initial complete retention run: 6 tests / 4 files passed in 31.97 s; a later
  partial-recovery regression is recorded separately. Full web suite and final
  evidence/current-head CI are pending at this note's initial revision.
- Typecheck/lint pass before the partial-recovery refinement; license gate has
  808 packages, 806 allowed, 2 established exceptions and 0 rejected.
- No raw traces, human screenshot sign-off or full browser/state/role matrix claim.

## 6. Sad paths proved

| Trigger                                             | Expected disposition                                        | Test                                |
| --------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------- |
| Missing consent, invalid policy or cleanup disabled | Refused; no new deletion                                    | Public policy action                |
| Unauthenticated or cross-origin mutation            | HTTP 401/403                                                | Actual HTTP server                  |
| Unavailable settings/preview                        | Visible error and retry; cleanup unavailable                | Real Chromium                       |
| Evidence root becomes a regular file                | Cleanup fails; durable intent and retry guidance persist    | Actual capture and browser          |
| Restart after repaired storage                      | Resume authorized deletion; retain baseline/recent evidence | Actual capture                      |
| More than 200 stored records                        | Whole-history counts; at most 50 new deletions              | SQLite scale boundary               |
| A later pending deletion becomes protected          | Earlier deletion count preserved; protected run remains     | SQLite/filesystem recovery boundary |

Red-first failures: missing retention action, missing HTTP endpoint, missing panel,
missing pending-recovery feedback and partial recovery reporting zero instead of
one. No assertion was loosened. These are scoped behavior checks; #402 stays open.
