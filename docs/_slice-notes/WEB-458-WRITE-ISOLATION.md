# WEB-458-WRITE-ISOLATION — staged doc updates

Issue: #458 · PR: #459 · Disposition: real storage fault reproduced and locally corrected; installed acceptance pending.

## 1. `docs/SYNC.md` — tracker row

```
| #458 | [WEB-458-WRITE-ISOLATION] Preserve healthy pages after evidence-write failure | ☐ in progress |
```

## 2. `docs/SYNC.md` — session-log row

```
| 2026-09-07 | **#458, in progress.** Reproduce per-file storage failure poisoning later healthy captures in all three engines. Reserve checkpoint ordinals by attempt; retain earlier/later captures, exact evidence-write finding and blocked coverage. Real server/dashboard proof passes; required installed CI remains pending. #448's original incident and full #402 remain open. |
```

## 3. `CHANGELOG.md` — proposed `Fixed` entry

```
- WEB-458-WRITE-ISOLATION (refs #458): reserve capture filenames per attempted checkpoint so one evidence-write failure cannot reuse its blocked destination for later healthy pages. Preserve blocked coverage and explicit diagnostics; exercise manual recovery with immutable prior results.
```

## 4. `VERSION` bump required?

Yes, user-observable partial-result preservation. The integrator selects the synchronized version after acceptance. This worktree does not edit shared metadata.

## 5. Evidence pointers

- [Red/green reference-app proof](../evidence/WEB-458-WRITE-ISOLATION/summary.md), masked screenshots, sanitized timelines and artifact bindings.
- `capture-write-isolation.real-world.test.ts`: real filesystem, real Chromium/Firefox/WebKit, server-startup queue recovery and GUI manual rerun.
- Existing capture-failure/baseline regression: 5 cases / 3 files pass; server-path journeys: 9 cases pass across Chromium/Firefox/WebKit dashboards, each with three real target engines. Helper selection/progress tests: 17 pass. Installed exact-head CI remains pending.

## 6. Sad paths proved

| Trigger                                      | Disposition                                                          | Proof                                  |
| -------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------- |
| Second PNG destination is a directory        | One evidence-write blocked checkpoint; two healthy captures retained | All three real engines, red then green |
| Reuse successful-capture count after failure | Contradicted by lost third page                                      | Retained red result and timeline       |
| Repair storage and explicitly Run again      | New complete three-page result; old blocked snapshot unchanged       | Real server/dashboard journey          |
| Omit new test from installed acceptance      | Selection contract fails                                             | Red then green helper test             |

No threshold or existing assertion is weakened. Broader failure phases, teardown recovery, the original #448 cause, full #402 and human release inspection remain unresolved.

PR #459 is based on merged footer PR #457 (`ec26b186`). Rebase conflicts affected only appended documentation, whose current acceptance records and both feature descriptions were preserved. Required final-head CI remains pending.
