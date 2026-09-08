# RELEASE-CAP-525 — staged doc updates (charter §10.2)

Issue: #525 · PR: <to-fill> · Disposition: observed (red is reproduced CI evidence: both ubuntu cells of two Release runs killed at exactly the 25-minute job cap with the unsharded core suite still passing tests mid-suite; the raised cap's green proof is this PR's own release-test matrix run on the PR branch, recorded below when it lands)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #<N> | [RELEASE-CAP-525] ubuntu release-test cells outlive the 25m job cap | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-09 | **#525 (RELEASE-CAP-525) release-test ubuntu cell cap DONE.** `timeout-minutes` is now matrix-conditional (`ubuntu-latest` → 90, windows/macos → 25) in `.github/workflows/release-test.yml`; red = runs 34245658145 + 34276464363 where both ubuntu cells were cancelled at 25m16–25m20s with steps 1–13 green and step 14 (unsharded `pnpm test`) still passing files with no summary; sizing from the same suite sharded in ci (15m40+16m05+17m15+10m19 ≈ 59m39s shard wall). Green = the PR's release-test matrix ubuntu cells completing under the new cap (workflow triggers on changes to its own file). Disposition observed; remedy 4 (packed-phase 900s cap) stays open on #525. Next: #525 remedy 4. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- RELEASE-CAP-525 release-test ubuntu cell cap (refs #525): the release matrix's ubuntu cells run the full unsharded core suite after ~9 minutes of install/Chromium/lint/typecheck/build/provenance steps; the flat 25-minute job cap killed both cells of two observed runs (34245658145, 34276464363) mid-suite with zero failing tests while windows/macos finished in 4–18 minutes. The cap is now matrix-conditional — 90 minutes for ubuntu, 25 for the others — sized from the suite's sharded wall time in the required ci workflow (~59m39s across four shards).
```

## 4. `VERSION` bump required?

No — CI/release-infrastructure only; no shipped artifact behavior changes.

## 5. Evidence pointers

- Red (observed CI): `docs/evidence/WEB-525-RELEASE-CAP/red-ubuntu-cells.txt` — job timings, step outcomes, verbatim log tail of job 102126843868 (last suite files passing at 15:59:38–16:00:02Z, runner orphan-process termination at 16:00:05Z, 25m16s after start).
- Sizing cross-check: required-ci run 34284745131 test shards 15m40s/16m05s/17m15s/10m19s.
- Green (this PR): release-test matrix run on this branch — ubuntu cells must reach a vitest summary and `success` under the 90-minute cap. Recorded here at merge time.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                        | Expected disposition                                                              | Test                                                                           |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Ubuntu release cell exceeds 25 min on the unsharded core suite | Job no longer killed mid-suite; cap sized to 90 min from measured shard wall time | Release-test matrix on this PR (runs 34245658145/34276464363 are the red pair) |
| windows/macos cells under the raised scheme                    | Keep the observed 4–18 minute envelope, cap unchanged at 25                       | Release-test matrix on this PR                                                 |
