# WEB-402-DRIFT-REVALIDATE — staged doc updates (charter §10.2)

Issue: #402 · Disposition: observed implementation (local green ×2; CI on the PR head is the remaining gate — an LLM cannot assign `verified`).

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```text
| #402 | Web product release: comprehensive frontend intent campaigns and AI visual auditing | In progress; per-fire source-drift re-validation — a recurring campaign whose source drifted (dirty tree or HEAD moved vs its pinned sourceCommit) is stopped at the fire boundary, before tick() creates any doomed run |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```text
| 2026-09-08 | **#402 (WEB-402-DRIFT-REVALIDATE) drifted recurring campaigns stop before they fire.** The fire path gains an async per-fire guard: every 1s tick first runs `Workbench.guardDueCampaigns()` — each DUE recurring schedule (cron armed, not cancelled, `nextFireAt <= now`) is re-validated against the real source (`sourceRevision`: dirty tree or HEAD ≠ the campaign's pinned `sourceCommit`) and, on drift, stops via the existing transactional `stopDriftedSchedules` (`nextFireAt → null` + audited `campaign.schedule-drift-stopped`) BEFORE the synchronous `tick()` creates any doomed run. Only due campaigns are validated, so steady-state cost is zero git subprocesses; the guard precedes the tick inside the same interval callback, closing the fire-boundary race; per-campaign fail-soft — an unreadable source (sourceRevision throws) is treated as drift and stops that campaign without blocking the others or the tick; `drain()`'s 409 `sourceDriftRefusal` + schedule stop is retained unchanged as the backstop for the residual race. Real-world proof: `campaign-drift-revalidate.real-world.test.ts` runs REAL discovery on the real reference-auth-app checkout, arms a real yearly-cron campaign, proves a clean fire, then introduces REAL drift between fires — a real `git commit` (test 1) and an untracked dirty file (test 3) — and asserts zero new runs, `nextFireAt` nulled, exactly one audited drift stop and no queued/running stragglers; test 2 is the positive control (clean source still fires after the guard, schedule re-arms, no drift-stop audit). Red first (`wb.guardDueCampaigns is not a function` after the harness proved the clean control fire). Regressions: campaign-recurrence, campaign-row-history, campaign-ui, workspace suites and campaigns unit 17/17. Gates local: apps/web typecheck ☑ · repo eslint ☑ · format ☑ (full repo after note); CI on the PR head is the remaining gate. Phase (b) — re-discovery binding that REMAPS a drifted campaign's rows by row identity and re-arms it on the new commit — remains the recorded follow-up. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```text
- WEB-402-DRIFT-REVALIDATE per-fire source-drift re-validation (#402): due recurring campaigns are re-validated against the real source before every fire — a drifted (dirty tree or HEAD moved vs pin) or unreadable source stops the schedule at the fire boundary with the existing audited diagnostic and zero doomed runs, while drain()'s 409 refusal stays as the backstop; proven against a real checkout with real git commit and dirty-tree drift between fires.
```

## 4. `VERSION` bump required?

No — the fold integrator owns `VERSION`; the capability rides the current `0.0.301` line.

## 5. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/campaign-drift-revalidate.real-world.test.ts` — real discovery over the real reference-auth-app fixture, real yearly-cron campaign, real `git commit` drift and real untracked-file dirty drift between fires, positive control on the clean source.
- Artifacts: `docs/evidence/WEB-402-DRIFT-REVALIDATE/red.txt` (first red: `wb.guardDueCampaigns is not a function` in all 3 tests, each after its clean-control fire passed) + `green.txt` (3/3, second consecutive green).
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (slice 3/3 ×2, siblings 17/17) ☑ · license gate → CI.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                           | Expected disposition                                                                    | Test                                                                                        |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| HEAD moved past the campaign's pinned sourceCommit between fires  | Guard stops the schedule pre-fire; zero doomed runs, one audited drift stop             | test 1 (real `git commit` between fires)                                                    |
| Dirty tree (untracked file) between fires                         | Same pre-fire stop, zero doomed runs                                                    | test 3 (real untracked file, no commit)                                                     |
| Clean source at the fire boundary                                 | Guard is a no-op; the slot still fires, schedule re-arms, no drift-stop audit           | test 2 (positive control)                                                                   |
| Unreadable source (sourceRevision throws)                         | Treated as drift: campaign stopped, loop continues (fail-soft per campaign)             | guard catch branch (sad-path-first by construction; not yet journey-covered — gap recorded) |
| Residual race: drift lands after the guard, before/during the run | `drain()` 409 `sourceDriftRefusal` + `stopDriftedSchedules` backstop retained unchanged | existing campaign-recurrence drift journey stays green                                      |
| Guard absent / method missing (pre-implementation)                | Journey red: `wb.guardDueCampaigns is not a function`                                   | `red.txt`                                                                                   |
