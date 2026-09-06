# Dashboard UX and production audit — WEB-402

Status: implementation and local validation completed on `feat/dashboard-production`; required PR CI is pending. This record does not certify a production release or human screenshot inspection.

## Scope and observed defects

The audit exercises the actual workbench in Chromium, source discovery against the Express reference repository, real visual jobs against the running Express application, and authenticated capture against the running Next.js reference application. SQLite history fixtures separately exercise retrieval beyond 200 records; those fixtures are explicitly blocked records and are not described as executed tests.

Observed and corrected:

- Navigation lost the selected section on refresh and quick Back; deleted-run bookmarks trapped an authenticated user at login.
- Run history offered only the latest 200 entries, with no project-name/ID search, type/status filtering or pagination. Filters now survive refresh and stale page offsets return to a valid page.
- A global backdrop dimmed masked screenshots even when both dialogs were closed. Scoping it to `dialog::backdrop` restores the captured surface.
- A 13px root shrank a nominal 28px control to 22.75px. The 16px root and explicit body type token restore the intended control size.
- Theme radio controls ignored arrow keys. Modal Tab could leave the dialog. Mobile hidden labels removed two buttons' accessible names. The folder picker claimed listbox semantics without implementing that keyboard pattern.
- Shared muted text, dark primary buttons and the primary hover treatment failed contrast. Inline evidence links relied on color alone. System color tokens now support forced colors.
- Screenshot review exposed 34px search-control center drift and absent sign-in glyphs under forced colors, despite passing automated checks. Explicit control-alignment and painted-glyph guards now cover those failures. Pagination uses a named navigation role, resolving the remaining aria-prohibited-attr review entries.
- Numeric measurement artifacts were inaccessible from the capture UI. The dashboard now shows measured checks, deltas, expected predicates, explicit coverage gaps and JSON download, with unavailable/retry behavior.
- Existing clone folders were silently updated; escaped clone parents could reach git before canonical containment was checked. Existing targets now require explicit connection; escaped parents are rejected before cloning.
- Optional continuous video retained unmasked frames despite masked screenshots. New configurations reject it and old enabled runs block before capture. Continuous redacted video remains unavailable. The recording-equivalent remains named masked screenshots and sanitized action timelines.

## Test scope

| Check | Evidence and limits |
| --- | --- |
| Seven sections × four widths × two themes | Chromium; 320, 390, 768, 1440 CSS pixels; light/dark; axe WCAG A/AA tags and document overflow. Empty workspace matrix, supplemented by populated journey. |
| Keyboard and overlays | Theme arrow keys, modal Tab containment, Escape/focus restoration, mobile navigation, forced colors. |
| Populated end-to-end journey | Login failure, connect/configure project, real source discovery, declaration search, real visual jobs, baseline approval, measurement retrieval failure/retry, run filters/refresh, schedules, administration, mobile settings, session expiry and stale responses. |
| Authenticated capture | Real Next.js login, missing-secret blocked path, masked checkpoint and no persisted session state/raw video. Redirect-based sign-in only; this is not proof of arbitrary MFA/SSO or same-page login success. |
| Run retrieval | Real SQLite, 206 historical records, literal search, paging/filter validation and stale-offset recovery. |
| Wider regression suite | Existing campaigns, reviews, providers, execution, HTTP and scheduler tests; results recorded below. |

Axe incomplete results are retained in audit JSON and investigated rather than silently passed. The pagination-related review entries were reproduced and corrected with valid navigation semantics. A zero-violation result does not certify every WCAG criterion, screen reader, browser or UX heuristic. The matrix does not imply all product states have been visited.

## Heuristic review

| Heuristic | Concrete dashboard behavior / limit |
| --- | --- |
| Visibility of status | Run state, loading measurements, explicit failures, result counts and uncovered states; no generic green page verdict. |
| Familiar language | Project, test run, type/status filters and named actions; source declarations are labeled hypotheses. |
| User control | Back/refresh/bookmarks, clear filters, modal Escape, cancel active runs; destructive operations remain explicit. |
| Consistency | Shared theme/type/spacing/control tokens, standard buttons, matching selected navigation, keyboard radio behavior. |
| Error prevention | Server validation, capture consent, secret-reference checks, protected approved baselines, no unmasked recording. |
| Recognition | Visible section heading, accessible mobile action names, labels for filters, measurement evidence beside screenshots. |
| Efficiency | Search all stored runs, project/type/status filters, pagination, source declaration/control search and selected campaigns. |
| Minimal presentation | Progressive details for evidence/coverage and advanced configuration; four responsive widths checked. |
| Recovery | Missing-run explanation, filter reset, measurement retry, expired-session recovery and persistent settings. |
| Help | Empty-state next actions, evidence scope and links to full artifacts; onboarding still assumes a running server-side test target. |

These are observed/tested behaviors and a bounded agent review, not an exhaustive human usability study. Independent user testing, screen-reader testing and human screenshot inspection remain open.

## Evidence and gate record

- Full web suite at `d08c84a`: **62 tests / 18 files passed**, 347.91 seconds. This includes real-engine reference-app execution, campaigns, provider/review browser journeys, authenticated capture, HTTP and storage tests.
- Image-review refinements at `30bf534`: **4 tests / 3 files passed**, 116.26 seconds: the 56-case matrix, populated light/dark journeys and visual-review browser flow. Search alignment and forced-color glyph guards passed without loosening assertions.
- Final pagination-semantics rerun at `1c48fc6`: **3 tests / 2 files passed**, 87.08 seconds. All 89 retained dashboard audit checkpoints have zero reported violations, zero incomplete entries and zero document overflow. Implementation paths were clean before this run; the working tree contained only the already-collected evidence. Screenshot sidecars truthfully retain that broader dirty-worktree flag.
- Lint, root/package typechecks and license gate pass. Full-repo formatting after the completed slice note: `All matched files use Prettier code style!`. Required PR CI remains pending.

The retained set contains 112 final screenshots plus seven explicit before/failure-era images and seven hash-linked sanitized timelines. [Artifact index](artifact-index.json) lists every PNG hash. `before/` is partial failure-era proof, not a completed passing journey. Raw traces and unmasked videos are not retained. The agent inspected all 119 retained images through contact sheets and selected full-resolution images, including the corrected search and forced-colors states; this is not human sign-off.

Model boundaries in provider/review browser tests are controlled local HTTP responses; they prove request/UI/persistence behavior, not paid-model intelligence. Campaign tests run the actual compiler/executor/verifier against reference apps with controlled model proposals. The ordinary dashboard journey performs real source discovery and Chromium visual jobs without invoking paid models.

Assertion corrections were explicit: the screenshot background oracle changed from the HTML root's 250 to the actual main surface's exact 255 RGB; no tolerance was widened. The detector's 20-route suggestion bound was restored to match its existing contract, while saved/crawled visual plans support their separately documented 200-page maximum. Tests wait for settled/reduced-motion rendering; theme interpolation frames are not represented as stable captures.

## Production gaps

No release was tagged or published. Human screenshot sign-off, fresh paid-provider inference across the supported provider profiles, retention/quota controls, clean distribution/deployment proof, browser/platform expansion and the complete visual-oracle detector/state matrix remain outside this passing dashboard claim. #402 remains open. No LLM assigns the product truth state `verified`.
