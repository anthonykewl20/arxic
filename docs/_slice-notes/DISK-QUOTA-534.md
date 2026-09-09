# DISK-QUOTA-534 — staged doc updates (charter §10.2)

Issue: #534 · PR: #535 · Disposition: observed — every planned proof ran green against the real engine, real fixture app and real Chromium; per ADR §2 the `verified` assignment stays with the human screenshot-inspection gate that remains owed on #402.

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
(No milestone row — #402 slice; record under the #402 status paragraph.)
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-07 | **#402 (DISK-QUOTA-534) evidence disk quota DONE.** Retention policies gain `diskQuotaMb` (integer 0–1,048,576 MB, 0 disables; master `enabled` + `confirmDeletion` consent gates unchanged). Preview measures real evidence bytes per run (missing run dirs count 0, symlinks never followed) and reports `quota { limitMb, measuredBytes, over, candidates }`; quota candidates are exactly the too-young unprotected runs beyond `keepLatest` (the `age` rows), oldest-finished-first, capped at the same batch limit as age deletion. Cleanup deletes age candidates then quota candidates while measured bytes exceed the limit, subtracting each deleted run's measured bytes (age-freed bytes included) and reports `stillOverQuota` honestly when protection keeps storage over quota — a completed outcome with `deleted: 0`, not an error. `previewRetention` became async (fs measurement is I/O); every call site awaited (route, panel, tests). Proof: 3 new unit tests (validation/round-trip, preview accounting, cleanup + honest guard), the real-world journey re-run against the real reference-auth-app with real Chromium captures and 1.2 MB injected quota pressure (cleanup deleted the right run, baseline byte-identical, audit row present), and the dashboard retention journey extended with the quota field in light + dark. The storage-quota criterion on #402's runtime/retention-controls list is discharged; human screenshot census still owed. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### Added`

```
- DISK-QUOTA-534 evidence disk quota (#534): retention policies accept `diskQuotaMb` (0 disables, ≤1,048,576 MB) so cleanup reclaims the oldest unprotected too-young runs once measured evidence bytes exceed the quota; the retention preview reports measured bytes and over-quota candidates from real on-disk sizes, cleanup subtracts freed bytes as it deletes, and the result reports `stillOverQuota` honestly when protected or newest runs keep storage over the limit; proven in a real Chromium journey against the reference auth app with 1.2 MB quota pressure and a byte-identical surviving baseline.
```

## 4. VERSION bump required?

yes — user-observable admin control (new "Evidence disk quota" field, preview line and cleanup notice on the retention panel, plus the `diskQuotaMb` field on the retention API) per RELEASES.md; integrator applies `pnpm version:patch` (0.0.400 → 0.0.401) at fold.

## 5. Evidence pointers

- Unit: `apps/web/src/__tests__/retention-quota.test.ts` — 3/3 (validation + round-trip; preview accounting incl. age/quota exclusivity; cleanup oldest-first + honest protection guard).
- Regression: `apps/web/src/__tests__/retention.test.ts`, `retention-http.test.ts`, `retention-recovery.test.ts` — 7/7 after the additive `diskQuotaMb` pin and async preview awaits.
- Real-world: `apps/web/src/__tests__/retention-quota.real-world.test.ts` — 1/1: real fixture app (vulnerableAuthApp), three real visual runs, 1.2 MB injection, cleanup deletes exactly the over-quota run, baseline byte-identical, audit `run.deleted` recorded.
- Dashboard journey: `apps/web/src/__tests__/retention-ui.real-world.test.ts` — 2/2 (light + dark) with the new quota field, preview line and cleanup flow.
- Gates: root + web typecheck ☑ · `pnpm lint` ☑ · `format:check` ☑ (last line pasted in the PR) · targeted suites ☑ (quota 3/3, retention 7/7, real-world 1/1, journey 2/2) · required `ci` ☐ (the merge gate — paste verbatim `pass` before claiming done)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                            | Expected disposition                                                                    | Test                               |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------- |
| Invalid quota (`-1`, `1.5`, `'5'`, `>1,048,576`, `null`)           | rejected with the quota-validation message; 400 over HTTP                               | retention-quota.test.ts            |
| Quota disabled (`0`)                                               | no measurement, no `quota` block in preview, no quota deletions                         | retention-quota.test.ts            |
| Bytes under quota                                                  | `over: false`, quota candidates listed but nothing deleted by quota                     | retention-quota.test.ts            |
| Baseline / newest (rank-1) / protected rows                        | never quota candidates; age and quota candidate sets stay exclusive                     | retention-quota.test.ts            |
| Protection keeps storage over quota (single approved baseline run) | cleanup completes with `deleted: 0`, `stillOverQuota: true`; run and dir intact         | retention-quota.test.ts            |
| Oldest-first quota reclamation under pressure                      | exactly the older run deleted, newer kept, freed bytes subtracted                       | retention-quota.test.ts            |
| Real 1.2 MB evidence over a 1 MB quota                             | cleanup removes the injected-pressure run; surviving baseline byte-identical; audit row | retention-quota.real-world.test.ts |
