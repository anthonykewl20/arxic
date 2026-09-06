# Dashboard browser journeys — WEB-443

Issue [#443](https://github.com/anthonykewl20/arxic/issues/443), PR [#444](https://github.com/anthonykewl20/arxic/pull/444). This proof covers dashboard navigation and inspection against real reference apps. It does not certify full product discovery, human usability or release readiness.

## Final local proof

Recorded from clean implementation `442b44721f78241fdcff6ca47db35187aa4eab0c`:

| Test group | Engine | Result |
| --- | --- | --- |
| Main source/project/run/measurement journey, light and dark | Firefox 153.0 | 2 passed |
| Capture search/filter/pagination/baseline/blocked states, light and dark | Firefox 153.0 | 2 passed |
| Captured element kinds and point/number lookup | Firefox 153.0 | 1 passed |
| Persistent overflow detector negative guard | Firefox 153.0 | 1 passed: correctly returned failed with 704px overflow |
| Navigation, keyboard/dialog, narrow widths, themes, forced colors, expired session | WebKit 26.5 | 1 passed |

Firefox: six tests across three files, 263.70s. WebKit: one test, 43.45s. All 157 PNG hashes and 11 original timeline hashes were checked. Firefox produced 98 audits: no Axe violations; five reports retained incomplete contrast results; only the intentional guard overflowed. WebKit produced 59 audits with no violations, incomplete checks or document overflow. The 24 driver, runner and gate contracts also passed. Full-repository formatting, web typechecking and changed-area lint passed before evidence publication; final-head CI is recorded in the linked PR checks.

Twenty representative screenshots were agent-viewed and retained here with their original privacy metadata and audit JSON. Nine sanitized timeline excerpts contain exact original entries for those images, with original and excerpt SHA-256 values and an explicit selection description. [manifest.json](./manifest.json) hashes the 84 retained machine artifacts, excluding itself and this narrative. Raw trace ZIPs are not retained. Human inspection remains **not performed**. Complete per-step installed-job proof is uploaded by CI; this selection is not the full run.

## Evidence and UX expectations

| Behavior / heuristic | Evidence and numeric expectation |
| --- | --- |
| Stable primary action while folder results load | [Loading](./firefox/dashboard-light/16-source-loading.png), [ready](./firefox/dashboard-light/17-source-ready.png), [exact button geometry](./firefox/dashboard-light/source-layout.json). Both retain the same corrected-input/error state; Continue position must be identical. The previous layout moved 55px during a delayed real folder response. |
| Measurement lookup restores context | [Desktop preview](./firefox/dashboard-light/10-measurement-report.png), [mobile region](./firefox/dashboard-light/14-mobile-measurement-region.png), [preview bounds](./firefox/dashboard-light/measurement-layout.json). Re-selecting the same measurement reveals the full image within the viewport; masked-pixel assertion remains unchanged. |
| Settings remain actionable on mobile | [Scrollable dark settings](./firefox/dashboard-dark/12-mobile-guided-settings.png): persistent Save action and close control, bounded dialog content. |
| Discovery exposes evidence and gaps | [Intent inventory](./firefox/dashboard-dark/03-intent-inventory.png): source evidence, truth labels, declaration pagination and explicit coverage gaps. Source hypotheses are not runtime verification. |
| Find a specific captured element | [320px type filter](./firefox/elements-light/06-kind-filter-320.png), [selected heading](./firefox/elements-dark/03-picked-heading.png): type/number/point lookup, parent selection and exact independent target-engine rectangles. |
| Filters and pagination preserve orientation | [No matches](./firefox/gallery-light/01-no-matches.png), [mobile page](./firefox/gallery-light/02-mobile-page.png), [combined filters at 320px](./firefox/gallery-dark/03-filtered-320.png). Three additional desktop-next/mobile-previous cycles assert rendered page state and zero overflow. |
| Failure/status visibility | [Blocked coverage](./firefox/gallery-light/07-blocked.png), [changed comparison](./firefox/gallery-dark/06-regression.png): filtering does not rewrite execution coverage. |
| System-color readability | [Before](./before-webkit-forced-colors/390-forced-colors.png), [after](./webkit/navigation/390-forced-colors.png). Prior WebKit buttons were white on #c0c0c0, 1.81:1. CanvasText/Canvas removes the Axe violation without changing its threshold. |
| Navigation and recovery | [Expired session](./webkit/navigation/expired-search-session.png), [project dialog](./webkit/navigation/390-dark-project-dialog.png), [320px providers](./webkit/navigation/320-dark-providers.png), [empty overview](./webkit/navigation/1440-light-overview.png). |
| Audit cannot settle away a persistent defect | [Deliberately widened login](./detector-guard/intentional-overflow.png), [audit](./detector-guard/intentional-overflow.audit.json): 1000px real-page form still fails with 704px overflow after fixed readiness boundaries. This is a controlled negative test, not a shipped layout. |

## CI and honest boundaries

Historical CI [34063249952](https://github.com/anthonykewl20/arxic/actions/runs/34063249952) at `6a412c7` passed all four shards, static, fixture apps, worker image and full Chromium installed validation (`HUMAN-FLOW-E2E PASS`, 604.823s; browser phase 481.594s). Both new dashboard jobs failed, so required CI correctly remained red. The final implementation corrects forced colors, measurement reveal/retry, source-picker movement and navigation before login completion. Consult [current-head PR checks](https://github.com/anthonykewl20/arxic/pull/444/checks) for final installed acceptance; the historical run is not a final-head pass.

The installed contract now contains 18 tests in 12 files. Firefox/WebKit run the same installed dashboard contract as Chromium, using the shared clean-room package setup. Dashboard-only validation cannot claim the full CLI workflow. Provider/campaign boundary controls use test adapters; no paid model inference quality is established here.

An earlier dark-gallery audit reported transient 42px overflow; subsequent diagnostics did not establish its cause. Static audits now wait for fonts and fixed animation-frame boundaries, retain bounded overflow geometry and wait for rendered pagination state. They **never poll until overflow passes**. This is static-scene readiness, not proof that all motion, lazy-image shifts or transient frames are defect-free. Temporal causality remains a #402 coverage gap.

Incomplete Axe checks stay unverified, even when functional assertions pass. Exact rectangle comparisons and zero-overflow assertions were not widened. Desktop WebKit is not real iOS/Safari device proof. This slice does not cover the full locale/RTL/zoom/role/data/interaction matrix, all aesthetic judgments, or human release sign-off.
