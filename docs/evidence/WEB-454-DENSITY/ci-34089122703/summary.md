# CI 34089122703 — light dashboard journey remains failed

[Required CI failed](https://github.com/anthonykewl20/arxic/actions/runs/34089122703) for PR #455 head `d49b051014f9c27a7eece3078ed5c469fb676fce`. CI screenshot provenance records the tested merge checkout separately. All source shards, static, fixture, worker, installed Chromium/package and installed WebKit jobs passed. Installed Firefox failed.

The bounded child facts show **code 1, signal null, killed false**, at 891,277 ms against a 900,000 ms command budget. Progress contains 26 passed cases and one failed light-theme case in `ui.real-world.test.ts`. This is an ordinary test failure; an aggregate timeout does not explain this second result. The earlier run's timeout hypothesis remains uncertain and historical.

The last retained light checkpoint is `13-run-history-unavailable`: Retry is visible after the deliberate failed-history request. Agent inspection found no obvious overlay hiding it. The next recovery step or assertion is not identified by this historical reporter. Receipt timestamps may be batched and cannot establish individual case duration. No assertion is waived and this failure remains open.

## Diagnostic follow-up, not a product fix

The reporter now retains only bounded failure category and current-module source line, optionally the reported test timeout; it excludes raw error bodies. The UI journey now bounds previously unbounded browser waits at 10 seconds and attempts a masked failure screenshot. The existing 120-second Vitest case deadline remains unchanged. This tightens browser waits; it does not relax a failing assertion.

A source-dashboard Firefox reproduction using Node 22.22.0 passes both unchanged light/dark behavioral journeys in 127.20 seconds (64.95/61.51 seconds per case). `node22-source/` retains masked recovery and signed-out checkpoints, complete sanitized timelines and progress. These were produced from the dirty diagnostic checkout, not a clean installed final head. They do not discharge CI or establish a root cause.

An earlier clean-installed local Firefox run passed all 27 cases/15 files in 780.9 seconds; its first exhaustive partition later passed in 500.2 seconds. CI now schedules two disjoint required partitions per Firefox/WebKit browser. All 15 files remain required and the default Chromium release journey runs all files. This increases total runner capacity while retaining 900-second command, 25-minute job and existing Vitest case limits. Partitioning is not claimed to fix the light journey failure.

The manifest binds retained artifacts, whose adjacent privacy/sanitization records remain unchanged. No raw trace, human inspection or production-readiness verdict is claimed. #454, #456 and #402 remain open pending their respective evidence and acceptance gates.
