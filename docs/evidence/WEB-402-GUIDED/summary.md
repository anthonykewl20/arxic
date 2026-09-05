# WEB-402-GUIDED — dashboard execution settings proof

Tracker: [#402](https://github.com/anthonykewl20/arxic/issues/402). This is the
guided configuration slice of the unreleased v0.0.200 web workbench. The full
product acceptance criteria remain open.

Final production/browser source: `0077a987329226e010c71dac2642ad7dfcfa85ee`.
Initial browser source: `045067e5ef6e79231ac2a9413d3bbe52bd957bf3`.
Local Linux, pinned pnpm and Chromium, actual Next.js/Express reference apps,
ephemeral ports and isolated temporary SQLite. The final browser context uses
Asia/Manila to independently test UTC display. No raw trace ZIP was retained.
All 24 PNGs were viewed by the agent; every PNG hash and both sanitized timeline
hashes match their adjacent provenance. Human release inspection was not performed.

## Test results

| Test | Result and proof |
| --- | --- |
| Missing selected secret | PASS: the job blocks before launch; state and retained files contain no resolved email value |
| Unsafe configuration | PASS: nine cases reject raw/admin credentials, production, excessive runtime/crawl, missing framework, policy bypass, anonymous credentials and cross-origin login before persistence |
| Guided engine execution | PASS: real Next.js fixture lifecycle, compiler and verifier produce a promoted login-to-home workflow with two passing replays, without a project configuration file |
| Existing configuration file | PASS: the same real engine journey still passes twice from a committed configuration file |
| Credential isolation | PASS: guided execution works with legacy credential variables empty; the external model boundary requires the selected Bearer credential; recursive retained-file scans, including SQLite/WAL, find no test email/password/model-key values |
| Form validation and persistence | PASS: Chromium rejects a raw credential, saves secret reference names and a five-minute runtime limit, then reloads them; [desktop](final/11-guided-settings.png) and [mobile](final/12-mobile-guided-settings.png) |
| UTC schedule display | PASS after reproduced failure: a 09:00 UTC cron previously appeared as unlabeled 17:00 local time; the unchanged assertion now sees 09:00:00 UTC in an Asia/Manila browser; [before](initial/05-schedule.png), [after](final/05-schedule.png) |
| Existing browser management journey | PASS: login/access refusals, session races, source inventory, real pixel comparison, explicit baseline approval, schedules, audit history, mobile layout and logout |

The six-file web run had 20 passing tests and one UI locator failure. The label
locators were corrected to include adjacent hint/option text; behavioral
assertions were not loosened. The corrected UI journey passed. The stronger
engine/secret suite then passed all 12 tests in two files (34.49 s). Final retained
browser proof passed in 13.29 s (14.21 s including startup). The initial guided
engine test failed with `blocked` before dashboard configuration was wired;
the same two-replay assertion passes after wiring. The initial missing-secret
case was rejected as an unknown project setting before implementation; its test
setup also needed the engine-required nonempty domain declaration.

Root/package typechecks, lint and version provenance passed locally. Required
current-head CI remains the merge gate; local evidence is not a CI completion claim.

## Retained artifacts

[Final action timeline](final/timeline.json) and its
[sanitization provenance](final/timeline.sanitization.json) describe only
allow-listed actions and assertion outcomes, with no DOM or network bodies.
Each named PNG in [final](final/) has adjacent `.privacy.json` provenance.
[Initial](initial/) preserves the earlier journey and ambiguous timestamp.
Password inputs are masked; the dashboard uses only reference-app data and
secret reference names. Temporary folder paths and loopback ports are test
infrastructure, not user project data.

## Boundaries

The model HTTP response is stubbed at the external API boundary. This slice does
not claim a fresh live-provider campaign or AI image interpretation. The browser
journey configures the guided mode; the separate real-engine test executes it.
Per-pass login configuration is validated against the existing engine contract;
this new web slice's execution proof uses the seed-API persona strategy.

No multi-workflow campaign, semantic image review, authenticated visual-state
campaign, worker setup UI, retention policy UI, clean-install release package or
human release sign-off is established here. Domain declarations enable seeders
but do not filter discovered routes. Feature flags describe the deployed app;
they do not toggle it. Model budgets are planning estimates, not billing limits.
