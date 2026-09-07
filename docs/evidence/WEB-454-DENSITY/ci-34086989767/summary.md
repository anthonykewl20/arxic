# CI 34086989767 — failed acceptance gate

Exact head: `71dc7dc2269bf712715952aaf6f9f231004e6f2f`, base `a156b0461caddd920aec84e42f4ad54ee4816123`. [Run](https://github.com/anthonykewl20/arxic/actions/runs/34086989767). PR #455 is not complete or mergeable on this result.

| Job | Result |
| --- | --- |
| Static checks | Pass, 2m57s |
| Source shards 1/2/3/4 | Pass, 11m20s / 13m54s / 13m23s / 9m00s |
| Reference fixture apps | Pass, 1m39s |
| Worker image | Pass, 4m35s |
| Package, installed Chromium dashboard, license and SBOM | Pass, 14m42s |
| Installed WebKit dashboard | Pass, 16m06s |
| Installed Firefox dashboard | Fail, 17m36s |
| Required aggregate `ci` | **Fail** |

The Firefox harness reported 961,614 ms total, 44,407 ms clean-room installation and 17,159 ms startup. The remaining 900,048 ms closely matches its 900,000 ms aggregate browser-command timeout. That supports a timeout hypothesis; it does not prove that no individual test failed or stalled earlier. The old harness did not retain structured exit facts or incremental test outcomes. Missing proof includes completion of the dark six-cell matrix, two element cases, and the contrast journey. A later local four-test Firefox matrix/element pass (48.63 s) does not discharge this CI failure.

The `chromium/`, `webkit/` and `firefox/` folders retain the density journeys only: 228 files bound by `manifest.json`, with matching screenshot and timeline provenance hashes. These are a named subset of the installed artifacts, not proof that every Firefox suite completed. Agent inspection includes native mobile element picking and the image-limit recovery form. No independent human inspection is claimed. Original failed-job artifacts are available in the linked run; retained files here contain no raw trace or credential payload.

Six Chromium density-dialog contrast checks remain explicitly unverified at narrow widths; #456 investigates that audit gap. No contrast waiver or production footer change is included in this PR.

## Diagnostic follow-up

The runner now writes incremental allow-listed case records (module basename, hashed case ID, source line, elapsed time and state) plus adjacent provenance. It records bounded child exit code, signal and killed flag on failure. Names, assertion values and exception bodies are excluded. Missing run-end or pending case completion is not a pass. Real Vitest/process tests cover a failing private canary, a successful case, interruption after case-start, a signalled timeout and an output-bound refusal.

The aggregate command budget remains 900,000 ms, every original browser test and per-test timeout remains unchanged, and the CI job budget remains 25 minutes. A clean-install Firefox reproduction with these diagnostics is in progress. Its outcome and a new exact-head CI gate are still required before acceptance.
