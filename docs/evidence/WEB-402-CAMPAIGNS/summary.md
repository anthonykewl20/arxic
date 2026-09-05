# WEB-402-CAMPAIGNS: durable selected-workflow campaigns

Refs #402. Release line: unreleased v0.0.200. Initial production source and live
probe: `78d0fe9d6ded6d9dec4b735302a06842bb0bfb64` on
`feat/web-workflow-campaigns`, 2026-09-05. Final UI correction proof follows below.
No release tag or publication is authorized by this report.

## Scope and proof boundaries

The administrator configures guided execution, discovers current source, selects
up to 20 eligible source surfaces and starts an on-demand campaign. Each selected
row gets a separate serial engine run with two verifier replays. The complete
source denominator stays visible; campaign management state never becomes an
LLM-assigned verified truth state. This is not exhaustive state/persona/flag
coverage or semantic image review.

The regression engine/browser cases use a controlled external model endpoint.
Next.js, source extraction, SQLite, Chromium, compiler, verifier and isolated
Mailpit execute for real. The additional live campaign uses an authenticated
host coding agent with tools denied and the operator's default model. No claim
is made that the configured model string selected the actual host model.

## Red-first findings and results

| Scenario / defect | Result |
| --- | --- |
| Missing discovery, invalid/duplicate/empty/stale/oversized row selection | Refused; no partial campaign jobs |
| Insufficient queue capacity | Whole campaign refused atomically |
| Missing guided settings, changed/dirty source | Refused before child insertion |
| Source changes while the server is stopped | Queued child blocks at launch; prior history remains |
| Campaign cancellation and restart | Unfinished children cancelled; durable rows/results preserved |
| Discovery or child referenced by a campaign | Individual deletion refused |
| Real deletion of 10,000 artifact files races campaign creation | Initially both operations succeeded and orphaned evidence; unchanged assertion passes after shared mutation serialization |
| Child selection missing from generated engine configuration | Initially a different route verified; exact child-row assertion passes after binding selected row and source commit |
| Uncompiled hypothesis in campaign totals | Initially mislabeled blocked; remains uncovered, with no campaign-level truth outcome |
| Anonymous/cross-origin campaign access | Refused by real HTTP authentication/origin policy |
| Guided browser selection, polling, execution and child links | Passed on real Next.js and Chromium |
| Checkbox caption layout | Initial screenshot showed stacked centered captions; geometry assertion reproduced it |
| Campaign child “Run again” | Initial generic action lost selected scope; replaced by campaign navigation |
| Campaign child deletion button | Removed from the protected child view; server protection remains authoritative |
| Mobile run table | Initial screenshot and geometry assertion reproduced clipped columns; labels and stacked rows corrected |

The full web suite passed 33 tests across eight files in 172.80 seconds before
final review corrections (178.30 seconds total). After adding the deletion race,
all seven campaign policy/source/recovery cases passed in 3.36 seconds. Root and
package type checks and lint passed. The initial browser proof at `78d0fe9`
passed in 47.65 seconds. No assertion was loosened to obtain a pass.

## Fresh live campaign

[Live machine results](live/results.json) record a single guided campaign with:

- two selected workflows, both verified with 2/2 replays;
- five unselected rows and one non-proposable row in the eight-row denominator;
- zero contradicted, blocked, uncovered or pending selected workflows;
- three real password-reset emails;
- successful credential scans over retained web/engine/SQLite/WAL bytes.

[Login result](live/login/result.json) and [reset result](live/reset/result.json)
retain the exact selected row, candidate row and verifier result. No independent
third-party-app campaign or provider comparison is claimed.

## Evidence and visual inspection

All four [initial dashboard PNGs](initial-ui/) and four [live workflow PNGs](live/)
were opened and inspected by the agent. PNG hashes match adjacent privacy
provenance. The initial dashboard timeline hash matches its adjacent sanitization
record. All four live action archives match sanitizer hashes/byte counts and
declared logical members; decoded members contain only projected context,
before and after events and pass credential scans. These `.zip` files are
sanitized action projections, not raw Playwright trace archives. No raw trace is
retained or attached.

Initial screenshots deliberately preserve the defects found by inspection:
[stacked checkbox captions](initial-ui/01-selected-workflows.png) and
[clipped mobile run columns and unsafe generic controls](initial-ui/04-workflow-result.png).
The campaign [desktop](initial-ui/02-verified-campaign.png) and
[mobile](initial-ui/03-mobile-campaign.png) denominator views already show the
selected/unselected distinction. Final corrected screenshots will be retained
separately; historical image bytes are not rewritten.

The live verifier policy masks the whole `main` region. Those four images cannot
establish hidden-content visual correctness. Functional claims depend on the
verifier's assertions and receipts. Agent inspection is not the required human
release screenshot inspection; that gate remains outstanding.

## Remaining release requirements

Recurring campaign configuration, retention/removal controls, worker/runtime
onboarding, broader state/persona/flag exploration, semantic AI image review,
authenticated visual checkpoints, clean server distribution, independent
real-app campaigns and human release inspection remain in #402.
