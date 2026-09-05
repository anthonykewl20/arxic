# WEB-401 initial workbench proof

Final UI proof source: `7bc26e7d8b7bdde71d803d1e2c7068dcbaf08d0e` (production code `9ed1962`) on `feat/web-workbench`.
Version: canonical `0.0.100`; public label `v0.0.100`.
Environment: Linux, real Chromium / Playwright 1.62.1, real Express and Next reference apps,
actual source scanner, SQLite queue, compiler and verifier. In-app interactive browser
connection was unavailable. This is automated browser execution plus agent image inspection;
**human browser execution and human release screenshot sign-off were not performed**.

## Named dashboard checkpoints

The [allow-listed action timeline](final-ui/timeline.json) has adjacent
[sanitization provenance](final-ui/timeline.sanitization.json). The eight final PNGs have adjacent
`.png.privacy.json` records; hashes and the timeline field inventory were independently
checked. The screenshot-privacy service validated PNG bytes before retention.
All eight final images below were viewed by the agent. The eight earlier root-level images at `9212787` remain immutable history: **16 retained screenshots in total, all viewed by the agent; human sign-off remains owed for all retained images**. No raw trace ZIP was recorded or retained.
These dashboard capture records are distinct from the engine's verifier-bound workflow attestations.

| Test/checkpoint | Result | Named screenshot |
| --- | --- | --- |
| Invalid login refused; late anonymous response cannot hide new session | PASS | [01 empty workspace](final-ui/01-empty-workspace.png) |
| Outside-root folder refused; valid project saved | PASS | [02 project](final-ui/02-project-overview.png) |
| Actual source inventory exposes login evidence | PASS | [03 intent inventory](final-ui/03-intent-inventory.png) |
| Explicit baseline approval; fresh capture has zero changed pixels | PASS | [04 comparison](final-ui/04-visual-comparison.png) |
| UTC cron persisted and enabled | PASS | [05 schedule](final-ui/05-schedule.png) |
| Root allow-list and approval audit history shown | PASS | [06 administration](final-ui/06-administration.png) |
| 390 × 844 dashboard fits viewport; sign-out reachable | PASS | [07 mobile](final-ui/07-mobile-overview.png) |
| Late pre-logout HTTP response cannot restore signed-out workspace | PASS | [08 signed out](final-ui/08-signed-out.png) |

Final retained UI run: **1 test passed, 9.99 s**. Both authentication ordering assertions
were reproduced red with delayed **real** HTTP responses: old authenticated data reopened a
signed-out workspace, and an old anonymous error hid a new session. Both pass unchanged after
session/refresh ordering fixes. The administrator token is cleared after successful sign-in.
The mobile capture now waits for the destination heading; an intermediate unretained capture
exposed that the earlier test could photograph the prior page before navigation finished.

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

The [first live probe](live-provider-blocked.json) ran on the uncommitted workbench and
returned blocked despite two passing replays. Its history is unchanged. A [diagnostic probe](live-provider-diagnostic.json)
at `a5d2bb1` exposed the cause: both replays received HTTP 500 on `/forgot-password`.
The reference app's reset action calls SMTP; this probe had not started Mailpit.

With an isolated real Mailpit Testcontainer on random ports, [the live positive probe](live-provider-mailpit.json)
at production code `9ed1962` returned **verified from the deterministic engine**, with
**2/2 clean replays, 3 actual emails and no network errors**. The same verification policy was
kept. This supplies a live coding-agent/reference-app positive and missing-dependency negative;
it is one candidate, not a comprehensive frontend campaign. Probe summaries retain only safe
result/diagnostic metadata; no prompts, account credentials or raw traces are attached.

The full product remains open in [#402](https://github.com/anthonykewl20/arxic/issues/402):
comprehensive frontend component/state/docs intent inventory, multi-workflow campaigns,
AI semantic image interpretation, authenticated visual checkpoints, guided runtime/secret/budget
controls and clean server-distribution proof. This evidence supports the initial #401 workbench,
not an exhaustive frontend coverage or public-release claim. No tag or publication occurred.
