# WEB-439 — browser/theme visual matrix proof

Refs #439 and #402. Engine/authentication proof uses clean runtime commit
`53443eb`; final dashboard proof uses clean follow-up
`b1187cfd9892fff9ff152aca132579f85e92974e`. Current-head CI is recorded in the PR
and issue before merge. This document does not approve a release.

## Execution and identity

The initial clean proof passed **5 tests / 3 files in 81.07 s**. It exercised
Chromium 151.0.7922.34, Firefox 153.0 and WebKit 26.5 through Playwright 1.62.1
on Linux/Node 24.18.0. CI separately uses Node 22.22.0. Final dashboard proof
passed both themes in **29.51 s** after touch-target and feedback fixes.

The full dashboard/privacy suite passed **215 tests / 43 files in 523.43 s**
before the UI follow-up. Its updated UI assertions subsequently passed; required
CI covers the final head. Root/package typechecks, lint and license passed (808
packages, zero rejected); final follow-up web typecheck passed. Full-repo format
is run after the slice note and its last line is recorded in the PR/issue.

## Pass/fail per test point

| Test point | Result and evidence |
| --- | --- |
| Unsupported, empty, duplicate or null selections | Pass: explicit project rejection; older requests default to Chromium/light. Nine project contracts and shared-budget contract pass. |
| Real browser/theme/viewport matrix | Pass: three engines × two schemes × two viewports (800×600, 390×844) produce 12 independent spec identities. [Baseline result](screens/engines/baseline/result.json). Browser request user agents independently demonstrate actual engine use. |
| Repeated baselines | Pass: all 12 captures are unchanged with zero changed pixels and the matching original baseline file. [Repeat result](screens/engines/repeat/result.json). |
| Dark-only regression | Pass: a controlled dark CSS change applied to the real vulnerable-auth reference response changes six dark cells; all six light cells stay unchanged. [Regression result](screens/engines/dark-regression/result.json). This injection is an explicit regression trigger, not an independent product design oracle. |
| Authentication | Pass: missing credentials block all six environments; seeded real Next.js authentication then produces six stable signed-in captures. Session state is masked and never retained as a storage/session file. [Source identity](screens/auth/proof-source.json), [timeline](screens/auth/timeline.json). |
| Unavailable engine | Pass: an explicitly simulated Firefox launch failure at the browser boundary leaves real Chromium evidence intact and aggregate outcome blocked; no raw provider error is exposed. This supplement is not a second real missing-install environment. |
| WebKit PNG metadata | Pass: actual browser capture exposed sRGB/sBIT rejection. Only validated fixed color markers are removed; encoded pixel chunks are unchanged. Strict PNG rejection still covers private metadata, malformed markers, bad CRC, duplicate/late markers and reduced precision. |
| GUI configuration and persistence | Pass: invalid selection feedback, selection save, six actual environments, keyboard operation and reopening settings. [Light timeline](screens/dashboard/light/timeline.json), [dark timeline](screens/dashboard/dark/timeline.json). |
| Touch and responsive use | Pass: exact 44px minimum label height, clicks in label padding, keyboard toggling and 320/390/768/1440 layouts. Corrected selection clears its stale error. [320px controls](screens/dashboard/dark/01-matrix-settings-320.png), [mobile results](screens/dashboard/light/03-mobile-results.png). |
| Matrix budget | Pass for the shared policy: three engines × two schemes × three viewports allow 33 pages per combination, 594 total checkpoints below 600. This is a policy-boundary test, not a 594-capture stress benchmark. |

## Evidence review and limitations

The retained set contains **56 named PNGs**, **12 sanitized timelines** and **14
dashboard axe/reflow reports**. Every PNG/timeline SHA-256 and clean-source marker
was independently checked. All retained screenshots were agent-viewed in contact
sheets; final mobile controls/results and a WebKit dark-regression original were
also reviewed full-size. No raw trace ZIPs are retained and no human screenshot
inspection is claimed.

Dashboard reports contain **zero violations and zero horizontal overflow**.
**Eight reports retain inconclusive color-contrast checks (ten nodes)**. A separate
local inspection identified dialog header/footer explanatory text for which axe
could not determine background color because of overlap with scrolled content.
These remain inconclusive, not contrast passes; the screenshots are available for
independent review. Automated checks do not certify all accessibility or UX criteria.

Red-first failures reproduced the absent environment controls and 18px label
height. The latter led to 44px targets and padding-click assertions. Mobile proof
was reframed to show the actual environment list after resizing. No existing
assertion or retained-PNG validator was weakened.

Engine rendering differences are isolated by baseline identity; raw pixel changes
are not semantic defect proof. The legacy Chromium/light spec key construction is
preserved by code, but no old installed-build migration was run in this slice.
Attached source proof is supplemented by the installed dashboard CI gate, not a
local packed 439 run. DPR, zoom, locale, direction, forced colors, OS/device and
arbitrary workflow-state matrices remain incomplete. WebKit is an engine build,
not real-device Safari certification. #402 remains open.
