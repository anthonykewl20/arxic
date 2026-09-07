# WEB-431-RETENTION — evidence and validation

Refs #431 and #402. Implementation: `8c9304c945502ca93a250df0e822e83ca65ee934`,
branch `feat/evidence-retention`, base `c14e7ec7bcc3a37b4ede40cbddb8e9ccf6cf2eb6`.
The final artifact run started from a clean checkout of that implementation.
Current-head PR CI is a separate completion gate, recorded on the issue/PR.

## Executed proof

| Check | Result | Boundary |
| --- | --- | --- |
| Full web suite | 93 tests / 27 files passed, 454.61 s | Existing dashboard, source, campaigns, reviews, baselines, deletion and new retention flows; run preceded the final separate recovery regression |
| Final committed retention suite | 7 tests / 5 files passed, 34.30 s | Actual reference-app/Chromium capture and dashboard journeys plus policy/API/SQLite boundaries |
| Settings unavailable → retry | Pass, both themes | Real browser, controlled HTTP failure |
| Preview unavailable → retry; explicit consent | Pass, both themes | Actual three-run history; mobile 390×844 |
| Cleanup filesystem failure → recovery feedback → retry | Pass, both themes | Actual capture files; evidence directory temporarily replaced with a regular file |
| Baseline remains after deletion | Pass, both themes | Exact original PNG bytes and loaded dashboard image |
| Restart recovery and automatic idle cleanup | Pass | Actual Chromium captures; isolated state, persisted timestamp boundary |
| Whole-history/batch limit | Pass | Supplementary 251-record SQLite boundary, 50 new deletions, protected records retained |
| Partial recovery count | Pass | Supplementary filesystem/SQLite boundary, one deletion followed by a protected pending run |
| Typecheck / lint | Pass | Final implementation |
| License gate | Pass | 808 packages, 806 allowed, 2 established exceptions, 0 rejected |

The initial missing policy/API/panel cases failed before implementation. The extended
browser failure case then exposed missing durable-recovery feedback. A later recovery
boundary reported zero deletions after one had succeeded; the unchanged expected
count now passes. No matcher was widened and no Arxic engine was mocked.

## Retained visual proof

All **10 PNGs were viewed by the agent**, and their adjacent privacy hashes and
both sanitized timeline hashes were independently checked after copying. Each audit
has zero recorded axe violations, zero incomplete checks and zero horizontal
overflow. Audits use WCAG 2 A/AA, 2.1 AA and 2.2 AA tags; that finite check set does
not certify all accessibility or UX requirements.

| Test point | Light | Dark |
| --- | --- | --- |
| Settings error and retry | [PNG](light/01-unavailable.png) | [PNG](dark/01-unavailable.png) |
| Mobile preview and consent | [PNG](light/02-mobile-preview.png) | [PNG](dark/02-mobile-preview.png) |
| Cleanup failure and recovery explanation | [PNG](light/03-cleanup-failed.png) | [PNG](dark/03-cleanup-failed.png) |
| Cleanup result and protected history | [PNG](light/04-cleaned.png) | [PNG](dark/04-cleaned.png) |
| Preserved original baseline capture | [PNG](light/05-baseline.png) | [PNG](dark/05-baseline.png) |

[Light timeline](light/timeline.json) and [dark timeline](dark/timeline.json) have
adjacent sanitization provenance. Retained data contains fixed test annotations,
viewports, audit counts, safe fixture names and capture-masked screenshots. No raw
trace ZIP, browser credential store or operator evidence is retained or deleted.

Agent review checked label/control grouping, desktop alignment, mobile wrapping,
error/recovery visibility, consent affordance and successful preserved-image loading.
The baseline view also exposes a pre-existing copy ambiguity: historical
`Needs-Baseline` / `Awaiting a reviewed baseline` remains alongside the later
`Approved Baseline` badge. The underlying bytes and history are correct; clearer
historical-versus-current approval wording remains a dashboard UX follow-up.

## Limits

No human screenshot inspection or human sign-off is claimed. This slice does not
cover the complete browser/OS/state/role matrix, all visual heuristics, recurring
campaigns, campaign deletion, disk quotas or SQLite compaction. Automatic cleanup
requires an idle queue. Already authorized deletion intents resume even after the
policy is disabled; a recovery failure refuses startup. Full #402 release readiness
remains open, including human release inspection and deferred global doc/version
integration described in the slice note.
