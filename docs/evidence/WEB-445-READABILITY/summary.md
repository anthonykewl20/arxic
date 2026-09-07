# Dashboard readability evidence — WEB-445

Refs #445, PR #446 and parent #402. Implementation source:
`9bc52fdd8aebd39e9203c49b7da565b9a287a198`. Final source screenshots record a clean
checkout and the actual browser engine/version. Installed CI acceptance is pending.

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
Incomplete accessibility checks remain unverified. No assertion tolerance was
widened to resolve a failure.

Earlier diagnostic runs exposed test-harness mistakes: inline styles were blocked
by CSP, fixture cleanup used wrong API shapes, and saving from Providers did not
navigate to Overview. Those were corrected rather than counted as passes. A
provider catalog heading's 1/64px intrinsic-width discrepancy was addressed with
its flexible heading layout; its screenshot did not demonstrate lost text.

The scope does not establish native zoom, arbitrary input-text clipping, all
locales/personas/states, every heuristic, transient animation-frame causality or
paid-provider quality. Full release readiness remains under #402.

## Source results

All six cases passed on each engine at the source commit above: the negative
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
