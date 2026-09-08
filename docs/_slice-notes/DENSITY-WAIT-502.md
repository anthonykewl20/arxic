# DENSITY-WAIT-502 — staged doc updates (charter §10.2)

Issue: #502 · PR: #517 · Disposition: mixed (exceedance mechanism observed under controlled load; the historical CI occurrence's exact trigger stays hypothesized, now fail-fast if it was a blocked run)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #502 | [DENSITY-WAIT-502] visual-density UI run wait outlives measured contention | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-09 (12) | **#502 (DENSITY-WAIT-502) visual-density webkit poll diagnosis DONE.** The second flake signature (shard-2 `dashboard-progress.jsonl` `failureKind: assertion` at the 90 s `.run-detail` poll) was attacked with retained CI evidence first: both retained `installed-dashboard-webkit-2` artifacts show the case green (~21 s/theme) because passing reruns overwrite the failed attempt's journal, so the failed-attempt run state is unprovable from CI archives. Local measurement then demonstrated the exceedance mechanism: the healthy three-environment journey takes 21–28 s unloaded, 51–59 s pinned to four loaded cores, and **103.7 s / 91.5 s per theme under full host load** (evidence `green-full-load.txt`) — i.e. a CORRECT run crosses the old 90 s poll window under contention. Fix: the journey now polls the real run API to a terminal state with a 240 s bound (a blocked or cancelled run fails immediately with its summary — which, since FLAKE-CAPTURES-502's `reason` field, names the transient — instead of spinning 90 s on text that can never match), then asserts the exact success sentence unchanged (30 s render-lag poll), journey timeout 150 s → 420 s, grounded in the measured loaded worst. The old code's failure mode under a completed-but-unrendered run was itself caught during the rewrite (1 s default poll timeout) and fixed with an explicit bound. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- DENSITY-WAIT-502 visual-density UI journey waits on run state, not a fixed text window (#502): the dashboard journey polls the run API to a terminal state with a measured 240 s bound (blocked or cancelled outcomes fail immediately with their summary and findings instead of burning a 90 s text poll), then asserts the exact capture sentence unchanged; grounded in measured correct-run durations of 103.7 s per theme under full load versus the old 90 s window.
```

## 4. `VERSION` bump required?

No — rides the open #402/#502 scope (fold precedent; test-infrastructure hardening within the unreleased web product).

## 5. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/visual-density-ui.real-world.test.ts` against the real `vulnerable-auth-app` fixture, real engine capture (chromium, three pixel densities) driven through the real dashboard in webkit (`ARXIC_DASHBOARD_BROWSER=webkit`), per-run `mkdtemp`, Mailpit env untouched.
- Artifacts: `docs/evidence/WEB-502-DENSITY-WAIT/green-full-load.txt` — full-load run, 2/2 green at 103.7 s / 91.5 s per theme (beyond the old 90 s window, inside the new 240 s wait).
- Timing evidence: retained CI journals (`installed-dashboard-webkit-2` of runs 34210326030/34214662112) show healthy durations of ~21 s per theme; local measurements: 28/20 s unloaded, 59/37 s four-loaded-cores, 114/96 s and 104/91 s full host load.
- Gates: typecheck ☑ · lint ☑ (primary root) · format ☑ (full worktree, last line in PR body) · test ☑ (webkit: unloaded 2/2, four-loaded-cores 2/2, full-load 2/2) · license gate — runs in CI, not run locally.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                              | Expected disposition                                                                                                             | Test                                                    |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Correct capture run slower than the old 90 s window under contention | Journey now waits up to 240 s on the run API and still asserts the exact success sentence                                        | full-load run (`green-full-load.txt`, 103.7 s / 91.5 s) |
| Run ends blocked or cancelled (transient engine failure)             | Immediate failure naming the state and the run summary (findings carry the FLAKE-CAPTURES-502 `reason` in the UI) — no 90 s spin | terminal-state loop (`visual run ended blocked: …`)     |
| Dashboard renders later than the API's completed state               | 30 s render-lag text poll (the 1 s default was caught red during this rewrite and is now explicit)                               | `visual-density-ui` light/dark                          |

Known gaps (honest): the historical CI occurrences' exact trigger (slow-correct vs blocked) is classified only as hypothesized — the failed-attempt journals are overwritten by passing reruns; the fix makes the next occurrence either pass (slow-correct) or fail fast with a named cause (blocked), either of which settles it. The local CI-severity red was attempted twice (16-way load, four-loaded-cores) and not reproduced — the poll portion stayed under 90 s — so this slice ships on measured exceedance reachability plus fail-fast diagnosability rather than a reproduced red; #502 stays open for the visual-density trigger classification.
