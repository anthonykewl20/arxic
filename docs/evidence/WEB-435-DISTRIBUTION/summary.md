# WEB-435 — installed dashboard and recovery proof

Refs #435 and #402. Local clean-install pipeline **passed** in 269.77 s.
Required current-head CI is recorded in the associated PR and issue; this document
is local evidence, not release approval. No registry publication was performed.

## Identity and execution

[Package identity](package-identity.json) records the actual tarball, CLI and frontend/job
hashes. Runtime implementation: `51ede44`; browser/recovery assertions: `1aba46e`.
All dashboard provenance records identify a clean checkout at capture time. The
package was installed outside the repository without workspace links. The installed
server starts compiled jobs and serves bundled assets without tsx or Vite startup.
Node 24.18.0, Playwright 1.62.1/Chromium, Linux. CI separately runs Node 22.22.

[Pipeline output](pipeline.txt) records each phase. The full path includes a real
Next reference app, an installed CLI login with three clean verifier runs, an
independently relocated bundle replay, rejected wrong-password/unreachable-origin
runs, and five installed-server tests across four test files. Campaign tests use
real Next, Mailpit, source analysis, compiler and verifier; only model proposals are
stubbed at the provider boundary. The stub cannot assign a verified execution result.

## Pass/fail per test point

| Test | Result and evidence |
| --- | --- |
| Missing token, missing assets, corrupt JS/job, relative roots, invalid port/origin | Pass: installed command refuses startup before readiness. The relative-root test first timed out against the permissive implementation, then passed after validation. |
| Frontend delivery and restart settings | Pass: versioned JS/CSS served from the installed package; retention policy survives restart; old cookie rejected and fresh login succeeds. |
| Reference discovery and visual flow, light/dark | Pass: actual source inventory, baseline approval/comparison, element inspection, invalid/unbound geometry refusal, filtered history, schedules, mobile forms and sign-out races. [Light timeline](web/dashboard/light/timeline.json), [dark timeline](web/dashboard/dark/timeline.json). |
| Dashboard navigation/heuristics | Pass for the named assertions: URL/deep-link/refresh/back, keyboard theme selection, dialog focus/escape, search alignment, expired sessions, 320/390/768/1440 widths, both themes, forced colors. [Timeline](web/navigation/timeline.json). |
| Selected functional campaign | Pass: two workflows, real login/reset and verifier execution; mobile results, ledger/source evidence, pending submission and session races. [Timeline](web/campaign/timeline.json). |
| Deletion/restart/queued execution | Pass: actual captures through the public installed API; failed filesystem deletion retains durable intent; restart completes deletion and preserves baseline bytes and historical result; interrupted run remains blocked and queued run executes normally. `restart.real-world.test.ts`. |

The new deletion test initially expected 500. It was corrected to the existing exact
409 + cleanup-retry message contract; its persistence, byte-equality and restart
assertions were retained. No existing assertion was weakened.

## Visual and heuristic review

103 named PNGs and four sanitized timelines have independently checked SHA-256
provenance. There are 95 accessibility/reflow reports: **zero violations, zero
incomplete checks and zero horizontal overflow**. The campaign's eight PNGs have
separate action assertions; they are not included in the axe report count.
All 103 screenshots were agent-viewed in contact sheets, with separate full-size
review of representative overview and comparison screens. Contact sheets were
private review aids; originals are retained here. No raw trace ZIPs are attached.

| Heuristic | Observed scope and limit |
| --- | --- |
| Status and recovery | Pending actions, invalid login, unavailable history/measurements, incomplete coverage and retry actions remain visible. Session loss does not restore stale authenticated state. |
| Wayfinding and control | Current navigation, breadcrumbs, refresh/back/deep links, mobile menu and keyboard/dismissible dialog assertions pass. |
| Recognition and data retrieval | Project/run/type/status filters, declaration search, source links, measured-region inspection and full JSON evidence links are exercised. |
| Consistency and grouping | Light/dark navigation, cards, form actions and comparison columns retain coherent alignment in reviewed screenshots. Search controls have an explicit sub-pixel center-alignment assertion. |
| Error prevention and truthfulness | Capture consent and baseline approval are separate; unsupported source/state coverage is explicit. Invalid geometry cannot create a trusted element overlay. |
| Responsive readability | Seven main views across four widths and two themes fit horizontally; mobile forms and forced-colors retain usable structure. |
| Help and efficiency | Empty-state next actions, setup explanations, retry controls and direct result links are visible. This does not establish novice task success, optimal wording or a comprehensive usability study. |

No new geometry defect was found in this scoped review. This does **not** establish
all WCAG criteria, all UX heuristics, optical centering, localization, every state,
non-Chromium browsers, real-device touch, or independent human business acceptance.
No human screenshot release inspection was performed. #402 remains open.
