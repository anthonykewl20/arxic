# WEB-401 initial workbench proof

Production code: `92127871eb035af3c30720c33c72d254e3f69811` on `feat/web-workbench`.
Version: canonical `0.0.100`; public label `v0.0.100`.
Environment: Linux, real Chromium / Playwright 1.62.1, real Express and Next reference apps,
actual source scanner, SQLite queue, compiler and verifier. In-app interactive browser
connection was unavailable. This is automated browser execution plus agent image inspection;
**human browser execution and human release screenshot sign-off were not performed**.

## Named dashboard checkpoints

The [allow-listed action timeline](timeline.json) has adjacent
[sanitization provenance](timeline.sanitization.json). All eight PNGs have adjacent
`.png.privacy.json` records; hashes and the timeline field inventory were independently
checked. The screenshot-privacy service validated PNG bytes before retention.
All eight images below were viewed by the agent. No raw trace ZIP was recorded or retained.
These dashboard capture records are distinct from the engine's verifier-bound workflow attestations.

| Test/checkpoint | Result | Named screenshot |
| --- | --- | --- |
| Invalid login refused; administrator opens workspace | PASS | [01 empty workspace](01-empty-workspace.png) |
| Outside-root folder refused; valid project saved | PASS | [02 project](02-project-overview.png) |
| Actual source inventory exposes login evidence | PASS | [03 intent inventory](03-intent-inventory.png) |
| Explicit baseline approval; fresh capture has zero changed pixels | PASS | [04 comparison](04-visual-comparison.png) |
| UTC cron persisted and enabled | PASS | [05 schedule](05-schedule.png) |
| Root allow-list and approval audit history shown | PASS | [06 administration](06-administration.png) |
| 390 × 844 dashboard fits viewport; sign-out reachable | PASS | [07 mobile](07-mobile-overview.png) |
| Late pre-logout HTTP response cannot restore signed-out workspace | PASS | [08 signed out](08-signed-out.png) |

Final retained UI run: **1 test passed, 17.16 s**. The logout assertion was reproduced
red (workspace unexpectedly visible), then passed unchanged after session/refresh ordering
was fixed. A subsequent added assertion confirms the already-existing form reset clears the
administrator token after login (1 test passed, 10.09 s); it required no production change.

## Broader validation

| Test suite / gate | Result |
| --- | --- |
| Web HTTP: anonymous/CSRF, outside-root/symlink/config, session/version API | 3 PASS |
| Web queue: missing config/instance lock, discovery/restart/cron slot, prelaunch cancel/delete, active Chromium cancel | 4 PASS |
| Actual Express visual regression: consent, baseline retention, zero diff, changed pixels/overflow, tampering, missing mask | 1 PASS |
| Existing AI/compiler/verifier integration against real Next app | 1 PASS; model endpoint is a boundary stub; actual two-pass verifier and promoted ledger |
| Dashboard reference journey | 1 PASS; eight checkpoints above |
| Combined changed-area suites (web + CLI + version/provenance/tarball + version-bound oracle/assembly) | 14 files / 44 tests PASS, 161.30 s before final logout fix; affected UI rerun after fix |
| Shared viewport capture / UI / version policy follow-up | 3 files / 4 tests PASS, 32.28 s |
| Root lint, root and package typechecks | PASS |
| Built version provenance and installed tarball smoke | PASS; installed CLI prints `v0.0.100` |
| License gate | PASS: 791 total; 789 allowed; 2 existing metadata exceptions; 0 rejected |
| Full repository format after documentation | PASS: `All matched files use Prettier code style!` |
| Required current-head CI | Pending at evidence commit; see PR/issue checks for integration result |

Three canonical oracle hashes changed because the bound auth-domain package version changed
to `0.0.100`. All were repinned to exact new values; no matcher or acceptance criterion was loosened.

## Live-provider result and release limits

[The authenticated live coding-agent probe](live-provider-blocked.json) returned **blocked**
with `ARXIC-VERIFY-BLOCKED-NETWORK`, although its two replay runs passed. This probe ran on the
uncommitted workbench before final version/UI changes; it is diagnostic history, not exact-head
release proof. It is not counted as a successful live campaign. No model prompts or credentials
are retained here.

The full product remains open in [#402](https://github.com/anthonykewl20/arxic/issues/402):
comprehensive frontend component/state/docs intent inventory, multi-workflow campaigns,
AI semantic image interpretation, authenticated visual checkpoints, guided runtime/secret/budget
controls and clean server-distribution proof. This evidence supports the initial #401 workbench,
not an exhaustive frontend coverage or public-release claim. No tag or publication occurred.
