# WEB-433-BASELINE-HISTORY — evidence and validation

Refs #433 and #402. Implementation `3377b7080bf81117a88e2ec4c876af85eec2ee72`,
branch `fix/baseline-history-copy`, base `f1bf6a66e1d73ad02eeb842c458ce5cd6ac9d153`.
Final retained proof was captured from a clean checkout of this implementation.
Current-head CI and merge are separate gates recorded on the issue/PR.

## Real-world checks

| Check | Result | Evidence boundary |
| --- | --- | --- |
| Approval unavailable, then keyboard retry | Pass, light/dark | Real Chromium; only the approval HTTP response is forced to fail |
| First capture later approved | Pass, light/dark | Historical no-baseline result and current badge are distinct |
| Subsequent comparison | Pass, light/dark | Actual second capture uses first run's baseline reference |
| Replacement affects future runs | Pass, light/dark | Actual third capture uses second run's baseline reference |
| Historical comparison after replacement | Pass, light/dark | Exact API result equality and original first-run image URL |
| First run revisited after replacement | Pass, light/dark | No current badge; exact original result and PNG bytes preserved |
| Mobile current approval and former baseline | Pass, light/dark | 390×844 layout; explicit status and historical explanation |
| Existing dashboard, retention and visual regression | 7 tests / 4 files passed, 127.19 s | Real reference apps and Chromium; unchanged byte and comparison assertions |
| Final committed baseline-history run | 2 tests passed, 27.02 s | Clean implementation revision above |
| Typecheck / lint / license | Pass | 808 packages, 806 allowed, 2 established exceptions, 0 rejected |

The intended explanation assertion failed before implementation. An initial test
setup attempted selection before login; authentication clears that selection, so
the journey now opens its recorded run after login. Product assertions were not
weakened. The retention test's old figure-caption wait now requires the explicit
current-approval badge, while retaining its original byte-preservation assertion.

No backend policy or comparison result is rewritten. The UI names comparison time,
the baseline used by that run, the capture from that run and current approval for
future runs. Missing baseline/difference images explain their historical absence.

## Inspected artifacts

All **12 PNGs were viewed by the agent**. Their privacy-sidecar SHA-256 values and
both sanitized timeline hashes were independently checked after copying. Every
recorded audit has zero axe violations, zero incomplete checks and zero horizontal
overflow (WCAG 2 A/AA, 2.1 AA and 2.2 AA tags). This finite audit is not complete
accessibility or heuristic certification.

| State | Light | Dark |
| --- | --- | --- |
| Approval failure | [PNG](light/01-approval-unavailable.png) | [PNG](dark/01-approval-unavailable.png) |
| First capture approved | [PNG](light/02-first-approved.png) | [PNG](dark/02-first-approved.png) |
| Current approval on mobile | [PNG](light/03-mobile-approved.png) | [PNG](dark/03-mobile-approved.png) |
| Actual comparison | [PNG](light/04-compared.png) | [PNG](dark/04-compared.png) |
| Comparison after replacement | [PNG](light/05-replaced.png) | [PNG](dark/05-replaced.png) |
| Former baseline on mobile | [PNG](light/06-mobile-history.png) | [PNG](dark/06-mobile-history.png) |

[Light timeline](light/timeline.json) and [dark timeline](dark/timeline.json) have
adjacent sanitization provenance. Agent review checked label grouping, historical
versus current status, error/retry visibility, consistent image captions and mobile
wrapping. Screenshots show persona-free fixture data and capture-time masks. No raw
trace ZIP or browser credential cache is retained.

## Limits

No human screenshot inspection or release sign-off is claimed. The full target
browser/state/role/heuristic matrix, broader #402 product work and deferred global
doc/version integration remain open. These tests exercise authenticated navigation;
retaining a pre-login deep link is not established. Original #431 screenshots remain
immutable historical evidence of the wording defect rather than being replaced.
