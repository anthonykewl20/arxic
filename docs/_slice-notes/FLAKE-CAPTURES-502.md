# FLAKE-CAPTURES-502 — staged doc updates (charter §10.2)

Issue: #502 · PR: <to-fill> · Disposition: mixed (diagnosability shipped and proven; the transient environment trigger itself is now self-identifying for whoever meets it next)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #502 | [FLAKE-CAPTURES-502] blocked visual runs retain the observed engine error | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-08 (11) | **#502 (FLAKE-CAPTURES-502) blocked visual runs identify their cause DONE.** Diagnosis: the zero-capture flake family (diff-viewer setup `expected undefined to be 'changed'`, changed-regions `first visual run produced no captures`) is the engine swallowing errors twice — per-checkpoint catch recorded only `failurePhase`, and the job entrypoint's catch wrote the fixed generic summary — so one transient navigation failure recorded a completed-looking run with zero captures and no cause anywhere. Fix: blocked-capture findings gain a one-line `reason` (observed engine error, evidence not recovery copy), the job entrypoint summary names the actual error, and the run-detail findings UI renders it. Proven red-first against the real engine: a dead-socket origin deterministically reproduces the blocked zero-capture navigation finding (previously cause-free, now `page.goto: net::ERR_*`), and the real `launchJob` entrypoint forked with a missing input now summaries `ENOENT` instead of the generic text; the write-isolation EISDIR pin was strengthened to assert the retained reason on all three browsers. Not done: the environment-level trigger (which transient the CI runners actually hit) remains open — future occurrences now report their own phase and reason, replacing rerun-and-pray with evidence. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FLAKE-CAPTURES-502 blocked visual runs retain the observed engine error (#502): per-checkpoint capture failures record a one-line `reason` alongside the failure phase, the engine entrypoint's blocked summary names the actual error instead of fixed guidance, and the run-detail findings UI shows the observed error, so a transient zero-capture run identifies its cause instead of forcing blind reruns.
```

## 4. `VERSION` bump required?

No — rides the open #402/#502 scope (fold precedent; operability fix within the unreleased web product).

## 5. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/capture-reason.real-world.test.ts` — real engine (`launchJob` fork, real Chromium via `launchDashboardBrowser`), a real TCP server that accepts and destroys connections (deterministic form of the transient class), per-run `mkdtemp` state, Mailpit env untouched.
- Artifacts: `docs/evidence/WEB-502-CAPTURE-REASON/red.txt` (verbatim 2/2 red before implementation), `docs/evidence/WEB-502-CAPTURE-REASON/green.txt` (2/2 green after).
- Gates: typecheck ☑ · lint ☑ (primary root) · format ☑ (full worktree, last line in PR body) · test ☑ (capture-reason 2, write-isolation 3 browsers, partial-loss, capture-failures — 7 green) · license gate — runs in CI, not run locally.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                          | Expected disposition                                                                                                        | Test                                                                     |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Target accepts and destroys the connection (dead-socket origin)  | Run blocked, zero captures, navigation finding carries `reason` matching `page.goto: net::ERR_*`; run-detail UI renders it  | `records the observed navigation error on a blocked zero-capture run`    |
| Engine entrypoint cannot read its job input (missing input file) | Blocked result whose summary names `ENOENT` (previously fixed generic text)                                                 | `names the failure when the engine entrypoint cannot read its job input` |
| Evidence destination faults mid-run (seeded EISDIR)              | Healthy siblings retained AND the evidence-write finding retains the `EISDIR` reason (assertion strengthened, not loosened) | `capture-write-isolation` (chromium/firefox/webkit)                      |

Known gaps (honest): the slice makes blocked runs self-identifying; it does not eliminate the underlying environment transient that CI hit (#502 stays open until an occurrence with a retained reason identifies it or load-hardening lands elsewhere); journey files still assert captures without first checking run outcome — hardening them is follow-up work once the reason field is available; the first red run of the new entrypoint journey failed for a test-authoring reason (forked without the production launcher's tsx `execArgv`) and was corrected to use the real `launchJob` path before evidence was captured.
