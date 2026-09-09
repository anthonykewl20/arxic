# RELEASE-CAP-525 — staged doc updates (charter §10.2)

Issue: #525 · PR: #529 · Disposition: observed (two reproduced reds on the release matrix: (a) both ubuntu cells of runs 34245658145/34276464363 killed at exactly the 25-minute job cap mid-suite; (b) with the cap raised, run 34288844027 on this PR exposed the masked second failure — the ubuntu cell installs only Chromium while the unsharded core suite runs WebKit journeys, so 10–11 files failed on `browserType.launch: Executable doesn't exist` with the workbench runs ending blocked. The green proof is this PR's release-test matrix run with both fixes, recorded below when it lands)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #<N> | [RELEASE-CAP-525] ubuntu release-test cells: 25m cap kill + chromium-only browser install | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-09 | **#525 (RELEASE-CAP-525) release-test ubuntu cell cap + browser matrix DONE.** Two-part fix in `.github/workflows/release-test.yml`: `timeout-minutes` is matrix-conditional (ubuntu 90, windows/macos 25 — red: runs 34245658145/34276464363 cancelled at 25m16–25m20s mid-suite, sizing from ci's shard wall 15m40+16m05+17m15+10m19 ≈ 59m39s), and the ubuntu cell now installs `chromium firefox webkit` like the ci shards (red: run 34288844027 on the PR itself — 90-minute cap held at ~57m, then 10–11 files failed on missing webkit-2336 executable, workbench runs ending blocked; required ci green on the same head proves the sharded/full-browser path). Disposition observed; remedy 4 (packed-phase 900s cap) stays open on #525. Next: #525 remedy 4. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- RELEASE-CAP-525 release-test ubuntu cell cap and browser matrix (refs #525): the release matrix's ubuntu cells run the full unsharded core suite, and the flat 25-minute job cap killed both cells of two observed runs (34245658145, 34276464363) mid-suite with zero failing tests while windows/macos finished in 4–18 minutes. Raising the cap (now matrix-conditional — 90 minutes for ubuntu, 25 otherwise, sized from the suite's ~59m39s sharded wall time in ci) exposed a second masked failure: the cell installed only Chromium, so the suite's WebKit journeys died on a missing playwright executable and their workbench runs ended blocked (run 34288844027: 10–11 files failed). The ubuntu cell now installs the same chromium/firefox/webkit matrix as the required ci shards; windows/macos keep the chromium-only install their scoped proof exercises.
```

## 4. `VERSION` bump required?

No — CI/release-infrastructure only; no shipped artifact behavior changes.

## 5. Evidence pointers

- Red (a) — cap kill: `docs/evidence/WEB-525-RELEASE-CAP/red-ubuntu-cells.txt` — job timings, step outcomes, verbatim log tail of job 102126843868 (last suite files passing at 15:59:38–16:00:02Z, runner orphan-process termination at 16:00:05Z, 25m16s after start).
- Red (b) — masked browser gap: `docs/evidence/WEB-525-RELEASE-CAP/red-webkit-browsers.txt` — run 34288844027 on this PR: cap held (~57m to summary), `browserType.launch: Executable doesn't exist at .../webkit-2336/pw_run.sh` in both cells, cascaded blocked-run assertion failures, suite summaries 11/321 (Node 22) and 10/322 (Node 24), required ci 34288844037 green on the same head.
- Sizing cross-check: required-ci run 34284745131 test shards 15m40s/16m05s/17m15s/10m19s.
- Green (this PR): release-test matrix run with both fixes on this branch — ubuntu cells must reach a vitest summary and `success` under the 90-minute cap with all three browsers installed. Recorded here at merge time.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                        | Expected disposition                                                                       | Test                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Ubuntu release cell exceeds 25 min on the unsharded core suite | Job no longer killed mid-suite; cap sized to 90 min from measured shard wall time          | Runs 34245658145/34276464363 (red); run 34288844027 (cap held ~57m) |
| WebKit journey in the core suite on a chromium-only cell       | Browser matrix installed up front; no `Executable doesn't exist`, no cascaded blocked runs | Run 34288844027 (red); next release run on this PR (green gate)     |
| windows/macos cells under the raised scheme                    | Keep the observed 4–18 minute envelope, cap unchanged at 25, chromium-only install         | Release-test matrix on this PR                                      |
