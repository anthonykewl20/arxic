# WEB-402-SCOPE: selected workflow execution

Source tested: `1c647c04848aeda6c440387b7ba840b468476083` on
`feat/scoped-workflow-execution`, 2026-09-05. Release line: unreleased v0.0.200.
Refs #402. This proof covers engine selection, not a campaign dashboard.

## Red-first and regression proof

The initial real Next.js web-engine test supplied a nonexistent source consumer
row and expected `blocked` with zero model requests. It instead returned
`verified` for the ordinary login candidate: the configuration silently ignored
selection. The unchanged behavioral assertion passes after the fix.

| Scenario | Disposition/result |
| --- | --- |
| Stale selected row, real source and web execution | Blocked before inference; zero model requests |
| Empty, malformed, duplicate or oversized configuration selection | Rejected |
| Changed or empty selection with a persisted terminal run ID | Blocked fingerprint mismatch; stored checkpoint preserved |
| Post-crawl form belongs outside the selected scope | No re-proposal/model request; full form inventory retained |
| Real Next.js login selected through the web action | Verified, 2/2 replays; only selected row is a candidate |
| Real Next.js password reset selected through the web action | Verified, 2/2 replays; three real Mailpit messages |
| Existing file and guided settings without selection | Verified, 2/2 replays each |
| Credentials in retained web/engine/SQLite/WAL bytes | Absent |

The five real web-engine cases passed in 76.71 seconds before final metadata
additions; the final rerun at the recorded source commit passed all five cases
in 77.93 seconds (79.16 seconds total). The configuration, shared worker projection, re-proposal, real
checkpoint and CLI helper suites passed 70 tests across five files in 20.38
seconds. The external model endpoint is the only mocked capability in those
engine cases; source parsing, Next.js, Chromium, compiler, verifier and Mailpit
execute for real. Root/package type checks and lint passed. No assertion was
weakened; the existing login-specific transition assertion remains on login
cases, and reset has its own exact selected-row/replay assertions.

## Fresh live-provider probe

The probe used the actual Workbench API, real discovery and current consumer IDs,
a committed configuration selecting one route per run, a running reference-auth-app
with isolated SQLite and Mailpit, and an authenticated host coding agent with tools
denied. The host CLI uses the operator's default model; no claim is made that the
configuration's model string selected the underlying host model. It is not a
multi-provider or independent third-party-app campaign.

[Machine results](results.json) record both runs, source commit, row IDs, eight-row
inventory denominator, verifier results, diagnostic codes and credential scan.
The selected login completed at 12:46:49 UTC; selected password reset completed at
12:47:13 UTC and produced three real emails. Each run passed both verifier replays;
only its selected source row was a candidate. Unselected rows remained present.

## Retained evidence and inspection

All four PNGs were opened and visually inspected by the agent. Their SHA-256 and
byte counts match adjacent privacy attestations. All four timeline archives match
adjacent sanitizer hashes/byte counts; archive members match the declared logical
members and contain only projected context/before/after events. Credential scans
of decoded timelines and retained run bytes passed.

| Workflow | Replay 1 | Replay 2 | Sanitized action timelines |
| --- | --- | --- | --- |
| Login | [Named screenshot](login/screenshots/001/001-step-1-login-page-home.png) | [Named screenshot](login/screenshots/002/001-step-1-login-page-home.png) | [Replay 1](login/timelines/001-trace.zip), [replay 2](login/timelines/002-trace.zip) |
| Password reset | [Named screenshot](reset/screenshots/001/001-step-1-forgot-password-page-forgot-password-page.png) | [Named screenshot](reset/screenshots/002/001-step-1-forgot-password-page-forgot-password-page.png) | [Replay 1](reset/timelines/001-trace.zip), [replay 2](reset/timelines/002-trace.zip) |

Each PNG has an adjacent `.privacy.json`; each timeline has adjacent
`.sanitization.json`. The `.zip` suffix is historical: these are sanitized action
projection archives, not raw Playwright traces. No DOM snapshots, raw network
bodies or original trace archives are included.

The existing engine policy masks the whole `main` region. All four images show
the mask and surrounding background. They prove a privacy-controlled capture
occurred; they cannot prove the hidden content's visual correctness. Functional
claims depend on deterministic verifier assertions and receipts. No human visual
inspection or release approval is claimed.

## Remaining scope

Each engine run compiles at most one candidate. Selecting several IDs only
limits the proposal pool. Dashboard row selection, durable multi-workflow
campaigns, authenticated visual checkpoints, semantic AI image review, broader
onboarding/admin controls, clean server distribution and human release inspection
remain in #402. No release tag or publication occurred.
