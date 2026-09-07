# Dashboard readability evidence — WEB-445

Refs #445, PR #446 and parent #402. The original full three-engine source
campaign ran at `9bc52fdd8aebd39e9203c49b7da565b9a287a198`. Installed CI then
exposed additional font-dependent defects; the corrective implementation is
`429123bf38a011151fee57ad375defdf8eac154f`. Current-head installed acceptance
remains required. Each screenshot retains its actual source/dirty/browser metadata.

The real workbench journeys connect a vulnerable-auth reference project, discover
its source, run the visual engine, select measured elements and use Administration
and provider controls. Four cases combine spacing/enlargement with light/dark;
a fifth deliberately clips the real login button. The existing normal-text
navigation audit runs alongside these cases. Profiles are applied at each mounted
view with computed-style canaries and CSP intact. The 200% profile enlarges mounted
HTML text; it is not native browser zoom.

## Reproduced problems and corrections

| Problem                                                           | Evidence and correction                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enlarged sidebar labels overlapped adjacent rows by 19px          | Before/sidebar captures and line rectangles; rows now grow, identity groups wrap and sidebar scrolling remains available.                                                                                                                                                                 |
| Administration split mid-word on desktop                          | Before/navigation-word records two lines; font-relative sidebar width retains the complete word while preserving space for overview cards.                                                                                                                                                |
| Enlarged mobile navigation split words in a fixed two-column grid | Before/mobile-navigation retains the visual finding; an added whole-word assertion reproduces it red. The column count now adapts to available width and text size.                                                                                                                       |
| Enlarged text cramped a fixed-height run button                   | Before/control has a scrolled detail; line rectangle exceeded its 32px box by 0.140625px. Text buttons now grow with content and retain minimum sizes. The metric is a Range extent, not a claim of missing glyph ink.                                                                    |
| Mobile Administration overflowed by 12px                          | Before/administration retains the failing viewport and diagnostics; breadcrumb/action and activity rows wrap.                                                                                                                                                                             |
| Firefox run heading/action extended beyond 320px                  | Before/firefox-run-overflow retains 176px document overflow and offending heading/button rectangles. Those elements were above the screenshot viewport: the image establishes context, not visible clipping. Run heading wrappers shrink and wrap, and actions can move onto another row. |
| Enlarged model catalog lacked keyboard focus                      | Before/catalog-focus retains the accessibility finding; its page-context screenshot does not show the below-fold scrollport. The region is now named/focusable, with End/Home assertions and a focused, scrolled final screenshot.                                                        |

The 10px login guard is intentionally defective. Its numeric containment finding
must fail even when Axe reports no violation; its test passes by detecting that
failure. Production screenshots do not inherit this stylesheet mutation.

## Evidence interpretation

Selected original PNG/privacy/audit files retain their bytes. Timeline excerpts
contain exact original entries for those screenshots; adjacent provenance records
the original timeline hash, excerpt hash and selection. No raw trace ZIP is retained.
`manifest.json` hashes the selected machine artifacts. Screenshots were inspected
by the agent; human visual/release inspection was not performed.

DOM Range line rectangles measure containment, not optical centering or glyph
correctness. Provider picker titles have an explicit recovery exception: actual GUI
activation must reveal the exact full heading, independently measured on mobile.
This corrects an ellipsis false positive without changing numeric tolerances.
Incomplete accessibility checks remain unverified. These original runs used zero
edge tolerance; the later precision correction below explicitly changes that comparison.

Earlier diagnostic runs exposed test-harness mistakes: inline styles were blocked
by CSP, fixture cleanup used wrong API shapes, and saving from Providers did not
navigate to Overview. Those were corrected rather than counted as passes. A
provider catalog heading's 1/64px intrinsic-width discrepancy was addressed with
its flexible heading layout; its screenshot did not demonstrate lost text.

The scope does not establish native zoom, arbitrary input-text clipping, all
locales/personas/states, every heuristic, transient animation-frame causality or
paid-provider quality. Full release readiness remains under #402.

## Original three-engine source results (before the CI font corrections)

All six cases passed on each engine at `9bc52fd`: the negative
guard, spacing/light, spacing/dark, enlarged/light, enlarged/dark and normal
navigation. No case was skipped in these final runs.

| Dashboard engine | Passing cases | Duration | PNGs / timelines | Incomplete audit reports |
| ---------------- | ------------- | -------- | ---------------- | ------------------------ |
| chromium         | 6 / 6         | 122.92 s | 126 / 6          | 26                       |
| firefox          | 6 / 6         | 195.06 s | 126 / 6          | 26                       |
| webkit           | 6 / 6         | 153.89 s | 126 / 6          | 28                       |

All 378 original PNGs and 18 original timeline hashes matched their provenance.
There were no accessibility violations or document-overflow findings. Each engine
produced exactly one failed numeric check: the expected clipped-login guard.
The machine-readable [source results](./source-results.json) preserve engine
versions and check counts.

## Selected captures

- [before/sidebar: 04-desktop-overview](./before/sidebar/04-desktop-overview.png)
- [before/control: 10-populated-measurements-text-detail](./before/control/10-populated-measurements-text-detail.png)
- [before/administration: 14-mobile-administration](./before/administration/14-mobile-administration.png)
- [before/catalog-focus: 15-mobile-providers](./before/catalog-focus/15-mobile-providers.png)
- [guard: clipped-button-guard](./guard/clipped-button-guard.png)
- [chromium/enlarged-light: 04-desktop-overview](./chromium/enlarged-light/04-desktop-overview.png)
- [chromium/enlarged-light: 14-mobile-administration](./chromium/enlarged-light/14-mobile-administration.png)
- [chromium/enlarged-light: 15b-keyboard-model-scroll](./chromium/enlarged-light/15b-keyboard-model-scroll.png)
- [chromium/enlarged-dark: 12-mobile-measurements](./chromium/enlarged-dark/12-mobile-measurements.png)
- [chromium/spaced-light: 09-populated-inventory](./chromium/spaced-light/09-populated-inventory.png)
- [firefox/enlarged-light: 03-source-wizard](./firefox/enlarged-light/03-source-wizard.png)
- [firefox/enlarged-light: 07-project-settings](./firefox/enlarged-light/07-project-settings.png)
- [firefox/spaced-dark: 16-mobile-provider-name-recovery](./firefox/spaced-dark/16-mobile-provider-name-recovery.png)
- [webkit/enlarged-dark: 13-mobile-navigation](./webkit/enlarged-dark/13-mobile-navigation.png)
- [webkit/enlarged-dark: 15b-keyboard-model-scroll](./webkit/enlarged-dark/15b-keyboard-model-scroll.png)
- [webkit/spaced-light: 08-connected-project](./webkit/spaced-light/08-connected-project.png)
- [webkit/normal-navigation: 390-dark-project-dialog](./webkit/normal-navigation/390-dark-project-dialog.png)
- [chromium/normal-navigation: 1440-light-overview](./chromium/normal-navigation/1440-light-overview.png)
- [before/navigation-word: 04-desktop-overview](./before/navigation-word/04-desktop-overview.png)
- [before/firefox-run-overflow: 12-mobile-measurements](./before/firefox-run-overflow/12-mobile-measurements.png)
- [before/mobile-navigation: 13-mobile-navigation](./before/mobile-navigation/13-mobile-navigation.png)

## Acceptance boundary

The installed dashboard contract is 23 tests in 13 files on each selected engine.
[PR #446 checks](https://github.com/anthonykewl20/arxic/pull/446/checks) record
current-head CI acceptance. Source proof is not an installed-package pass; required
CI must finish successfully before merge. Root/web typechecks and full lint passed
locally; the final format result is recorded in the PR after all documentation.

Issue #402 remains open. No release, deployment, human sign-off or full heuristic
certification is asserted. Historical focused runs used name filters for diagnosis;
their excluded cases are not counted as passes.

## CI font failures and corrections

Installed CI [34070174127](https://github.com/anthonykewl20/arxic/actions/runs/34070174127)
failed at PR head `395c78e` (merge checkout `e66da90d1a898fb1a25f208fede7b27833b34b8e`).
Shard 2 had two readability failures; all three installed dashboard jobs also
failed. Their pass requirements were not waived. Retained CI metadata includes
`dirty: true`; it is preserved rather than rewritten as a clean checkout claim.

Enlarged Administration had 27px document overflow: its H1 text extended 43.45px
beyond its box, and the activity heading's SMALL element also exceeded the
viewport. The title is visibly cut in the retained CI screenshot. A local
DejaVu Sans response override reproduced the exact measurements. Headings now
wrap within their available width and section-heading children can wrap onto
another row. At 200% on a narrow screen, a long heading may span lines.

WebKit also caught a populated folder row whose metadata exceeded its button by
43.603515625px. Its screenshot visibly cuts “no package.json”. The row and metadata
now wrap. The source-wizard audit waits for real folder rows and scrolls a
no-package row into a dedicated capture, preventing a loading state from masking
this data-dependent defect.

The diagnostic font override is **not** the production font configuration. The
[diagnostic record](./font-diagnostic.json) gives the exact CSS, computed-font
canary and production CSS hash. The first glob-only probe missed the versioned
stylesheet and is not font-reproduction proof. Corrected Firefox red/green runs
were 34.78s / 38.32s; the WebKit picker red and final scrolled proof were 8.51s /
32.70s. These were focused cases, not whole-suite passes. The temporary font
override was removed before committing the production fix.

After the corrections, clean Chromium at `429123b` passed all six normal-font
readability/navigation cases in 119.50s. All 130 PNGs and six timelines matched
their hashes. There were no accessibility violations, document overflow or
unexpected numeric failures; 28 incomplete reports remain unverified.
[Current source results](./font-source-results.json) preserve the 1,834 numeric
checks and expected negative guard. Required installed CI must still pass on
the final PR head.

Supplemental inspected captures:

- [CI Administration clipping](./before/ci-font-administration/14-mobile-administration.png)
- [CI folder metadata clipping](./before/ci-font-picker/03-source-wizard-text-detail.png)
- [Corrected Administration under the diagnostic font](./fallback/firefox/14-mobile-administration.png)
- [Corrected folder metadata under the diagnostic font](./fallback/webkit/03b-folder-metadata.png)
- [Committed normal-font folder metadata](./font-final/chromium/03b-folder-metadata.png)
- [Committed normal-font Administration](./font-final/chromium/14-mobile-administration.png)

The complete retained selection is 27 inspected PNGs and 22 exact sanitized
timeline excerpts. This includes historical failures, diagnostic overrides and
normal-font corrections; it is not a set of 27 passing test points.

## Second installed CI failure and explicit measurement precision

CI [34071728564](https://github.com/anthonykewl20/arxic/actions/runs/34071728564)
on PR head `3b6550b` passed static, fixture apps, packed Chromium and all four test
shards (2,090 passed, two existing worker-only skips). Installed Firefox failed
spacing/light and spacing/dark at the populated run heading: raw right-edge spill
`0.0000152587890625` CSS pixels, with no document overflow or Axe violation.
The scrolled screenshot shows the complete heading. Installed WebKit separately
failed baseline-history/light on a Fetch API page error; its cause is unresolved.
The overall CI gate failed; these results do not establish completion.

**Assertion change:** text containment now allows `1 / 65536` CSS pixel at each
edge. This is an explicit widening of the former zero tolerance, not a product CSS
fix. Raw spill values remain unchanged in audit JSON and each control records the
resolution. Mozilla's [DOMRect conversion](https://searchfox.org/firefox-main/source/dom/base/DOMRect.cpp)
rounds layout coordinates at this resolution. The retained CI discrepancy equals
one such unit; this supports a bounded precision budget, not a claim that every
future small discrepancy has the same cause. A golden case from the CI numbers
failed before the change; independent 1/64-pixel spills on all four edges still
fail. Missing text and non-finite edge measurements also fail. The real clipped
login control remains a separate negative browser test.

Three local WebKit diagnostics (original navigation, a held authenticated refresh,
and twelve navigation attempts at state-response boundaries) did not reproduce
the CI Fetch API error. No navigation workaround or error suppression was added.
Baseline-history now reports closed stage/error/endpoint categories without URLs,
credentials, response bodies or raw stacks, and records page-error counts alongside
its screenshots. Its final no-page-error assertion remains in force. A subsequent
installed run is required to investigate the CI-only behavior.


The final local precision probe reproduced the **same** Firefox width
`359.01666259765625` and right spill `0.0000152587890625` using the canaried
DejaVu Sans response override. The bounded predicate passed while preserving the
raw difference; the complete real spacing/light journey passed in 41.80s. The
font override and extra diagnostic screenshot step were then removed.
The screenshot scrolls the heading into view; its accompanying diagnostic audit
preserves coordinates measured before that scroll. Normal-font Firefox passed all
five readability cases (143.31s), including the failing clipped-control predicate;
WebKit passed both instrumented baseline-history cases locally (27.63s). These
runs used uncommitted edits on `3b6550b`, recorded as dirty, and are not clean-head
installed acceptance. Their 83 PNG and seven timeline hashes matched. Six
numerical cases passed, including rejection of non-finite measurements.
[Precision results](./precision-results.json) retain the exact limits and scope.

| Evidence | Result |
| --- | --- |
| [CI Firefox heading](./precision/ci-firefox/10-populated-measurements-text-detail.png) | Complete painted text; zero-tolerance predicate failed on one resolution unit |
| [Local canaried Firefox heading](./precision/font-firefox/10b-run-heading.png) | Same raw discrepancy retained; bounded comparison passes |
| [Instrumented WebKit mobile history](./precision/webkit-baseline/06-mobile-history.png) | Local history case passes with zero page errors; CI cause still unresolved |

The complete retained selection now contains 30 agent-inspected masked PNGs and
25 exact timeline excerpts. Human inspection and release approval remain owed.


## Installed precision acceptance and bookmarked-run correction

CI [34073809235](https://github.com/anthonykewl20/arxic/actions/runs/34073809235)
passed on `2b1a835`: all four shards (2,096 tests, two existing worker-only skips),
static, fixtures, packed Chromium and installed Firefox/WebKit. The shared
23-case/13-file installed contract produced 867 hash-checked dashboard PNGs and
78 timelines. Each engine retained the intentional 704px overflow guard and
failed clipped-login numeric predicate; no other overflow/numeric failures or
Axe violations were present. Incomplete Axe reports remain unverified. The
conditional worker-image job was skipped. [CI record](./precision-ci-results.json)
preserves the merge-checkout identity and original dirty flags. That pass predates
the login fix below and does not discharge its required current-head CI.

A further real navigation probe exposed a deterministic wayfinding defect:
opening a bookmarked run while signed out lost both its URL selection and its
detail panel during sign-in. The old test immediately navigated again after the
login click, hiding that defect and racing the asynchronous refresh. Requiring
the requested detail **before** the second navigation failed; the explicit
numeric assertion recorded `requestedRun=false` and `detailVisible=false` (7.19s).
Successful sign-in now re-reads the requested URL before refreshing. Session
cleanup still clears unsent drafts, consent and stale asynchronous state.

Clean implementation `d6ff592` passed two baseline cases in WebKit (36.64s), two
in Firefox (46.90s), and six Chromium baseline/UI/campaign/review cases (206.01s).
Each baseline case completes 18 real sign-ins and reloads below the server's
sign-in rate limit. Requested detail appears before reload; baseline approval,
replacement history, source image identity and mobile review still pass. The
broader Chromium cases retain stale-response, unsent-draft and consent-reset
checks. All 104 PNG and ten timeline hashes matched, with no unexpected numeric
failures, document overflow or Axe violations; four incomplete reports remain
unverified. [Login results](./login-results.json) record the exact revision/scope.

| Evidence | Observation |
| --- | --- |
| [Before: lost bookmarked run](./login/before/00-bookmarked-run.png) | Only the list remains after sign-in; requested detail is absent |
| [After: WebKit](./login/webkit/00-bookmarked-run.png) | Requested run opens directly after sign-in |
| [After: Firefox](./login/firefox/00-bookmarked-run.png) | Requested run opens directly after sign-in |
| [After: Chromium](./login/chromium/00-bookmarked-run.png) | Requested run opens directly after sign-in |
| [Fresh-session review](./login/session-consent/06-new-session-consent.png) | Unsent criterion and screenshot consent remain cleared |

The general WebKit early-reload event remains explicitly tracked in
[#447](https://github.com/anthonykewl20/arxic/issues/447). It was reproduced during
an outgoing sign-in refresh, but shorter probes sometimes passed. A pagehide
cancellation candidate failed and was removed. No Fetch API error filter or
production lifecycle cancellation was retained. The login fix and correct
completed-sign-in precondition do not establish a general early-reload fix.

The complete selection now contains **36 agent-inspected masked PNGs and 31 exact
timeline excerpts**. Required CI against the login/evidence head, broader #402
coverage and human release inspection remain outstanding.


The follow-up CI run [34075361763](https://github.com/anthonykewl20/arxic/actions/runs/34075361763)
on `3afd1dd` failed source shard 1: the light gallery retained five healthy-page
captures where six were required. All three installed dashboard jobs passed;
this does not waive the source failure. The original missing-capture cause is
unresolved in [#448](https://github.com/anthonykewl20/arxic/issues/448).
The gallery now retains per-cell capture/findings diagnostics under the shared
CI evidence directory and a named failed numeric screenshot before the original
six-capture assertion. No count, privacy gate, or retry policy was relaxed.

A focused normal real Chromium gallery run passed (61.34 s). A temporary real
reference proxy refusal of the Firefox root page then made the same test fail
at four captures (60.34 s), with both Firefox cells explicitly zero. This
controlled guard proves the new diagnostic branch, **not** the cause of the CI
five-capture failure. The injection was removed. The agent-viewed
[masked failure screenshot](./gallery-diagnostic/07-blocked-capture-shortfall.png),
[failed numeric audit](./gallery-diagnostic/07-blocked-capture-shortfall.audit.json),
[per-cell record](./gallery-diagnostic/blocked-matrix.json) and exact timeline
excerpt retain source `3afd1dd`, dirty=true. No raw traces or error messages were
retained. Latest-head CI is still required.
