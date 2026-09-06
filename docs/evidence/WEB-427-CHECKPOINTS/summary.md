# WEB-427-CHECKPOINTS — authenticated workflow gallery proof

Refs #427, PR #428, ongoing product #402. No release authorization or human visual
inspection is claimed.

Implementation: `50568a7`; final spacing correction: `11d2bea`. Before screenshots
are under `before/`; final screenshots under `light/` and `dark/`. The recorded
`dirty` flag includes evidence generated during these runs; the final proof uses
committed implementation bytes at `11d2bea` with untracked evidence only.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Dashboard + changed CLI/worker areas | 96 tests / 24 files pass, 351.13 s | Full web suite plus checkpoint config and worker policy tests at implementation `50568a7` |
| Actual guided workflow + gallery | Pass, 29.32 s at `11d2bea` | Real Next.js reference app, source/compiler, Chromium and two passing verifier replays; fresh light/dark GUI journeys |
| Privacy package | 82 tests / 6 files pass, 16.89 s | Actual Chromium masking/ambiguous-region tests plus binding, attestation and safe-filesystem gates |
| CLI malformed capture, dashboard consent, worker malformed capture | Refused as expected | Red-first tests; valid configuration round-trip also passes |
| Changed provenance/image and image symlink | Refused as expected | Real run artifact API; screenshot error and retry shown below |
| Gallery padding | Before 0px fails 16px minimum; final passes | Screenshot review found the defect; unchanged numeric assertion proves the correction |
| Accessibility/reflow | No axe violations or horizontal overflow in 8 final captures | Adjacent `.audit.json`; incomplete axe checks remain explicitly recorded |
| Local static/compliance | Typecheck, lint, license gate pass | License gate: 808 packages, 806 allowed, 2 existing exceptions, 0 rejected |
| Required current-head CI | See PR #428 checks | Initial CI failures and their corrections are recorded below; merge requires `ci pass` |

The focused proof command selects the guided case; five other cases are filtered
out in that command. All six agent modes ran in the 96-test suite. The spacing-only
follow-up reran the relevant real browser journey. Assertions were not widened.
Test setup corrections included a missing required domain, exclusive workbench lock
ownership, an explicit browser context for axe and a GET catalog response at the
controlled model boundary; the endpoint failure was not a product assertion failure.

## Named final screenshots

| Test point | Light | Dark |
| --- | --- | --- |
| Open authenticated verifier checkpoints through Test runs | [Desktop](light/01-checkpoints.png) | [Desktop](dark/01-checkpoints.png) |
| Changed image produces explicit error and Retry | [Error](light/02-changed-evidence.png) | [Error](dark/02-changed-evidence.png) |
| Retry restores the image; mobile gallery reflows | [390×844](light/03-mobile-checkpoints.png) | [390×844](dark/03-mobile-checkpoints.png) |
| Persisted semantic settings; visible keyboard focus | [Settings](light/04-capture-settings.png) | [Settings](dark/04-capture-settings.png) |

[Light timeline](light/timeline.json), [dark timeline](dark/timeline.json), adjacent
sanitization provenance and image privacy records are retained. Before-spacing
screenshots/timelines are preserved under `before/`. All 16 PNGs were agent-viewed;
16 image hashes and four timeline hashes were independently recomputed and matched.
Only allowlisted test annotations, numeric results and viewport dimensions enter
timelines. Password controls are masked; no raw trace ZIPs are retained or attached.

## Proof limits

The model endpoint is a controlled external response boundary; the application,
source engines, compiler, verifier, fixture app and browser are real. This is not
paid/live-provider inference proof. The GUI starts from a real completed engine run,
then performs login, navigation, image retry and settings inspection/save through
the actual dashboard. The captured target region is its public heading after login;
it does not establish whole-page pixel correctness or complete authenticated state
coverage. Final desktop viewport is 1440×1000; mobile is 390×844, Chromium, reduced
motion, light/dark. No full WCAG certification, every heuristic, other browsers,
locales, roles or worker-container custom-region result is claimed.

Gallery copies retain original image/provenance bytes; the original filename is
explicitly mapped in the UI. These are workflow checkpoint evidence, not visual
baselines. The shared existing masking runtime can mask broader landmarks when a
declared anchor is missing; it refuses capture if no bounded mask fallback exists.
The full #402 acceptance matrix and required human release inspection remain open.

## CI-discovered corrections

Initial CI `34043268950` at `50568a7` failed two assertions: the existing light-theme
history Retry control timed out, and the canonical-contract structural gate rejected
a duplicate SHA-256 helper. Both were reproduced locally before correction. The
history test now holds the manual search's state response until a background poll
supersedes it; with history returning 503, it reproduced the same Retry timeout.
Failure classification now belongs to the latest refresh, and stale errors are
ignored. The artifact reader uses the existing contracts SHA-256 function.

At `aec24c6`, the two full light/dark UI journeys and eight canonical tests passed
(10 tests, 65.17 s on the same fix before the evidence-only hook). No assertion was
widened and the no-duplicate-helper gate gained no exemption. Focused history proof
is under `history/`: the error state and subsequent baseline/recovery state, with
adjacent numeric audits, masked PNG provenance and sanitized timelines. Final
current-head required CI is authoritative at [PR #428 checks](https://github.com/anthonykewl20/arxic/pull/428/checks);
merge requires `ci` to print `pass`.

Retained history proof at `aec24c6` passed both full UI journeys (67.48 s). The
current guided engine/gallery rerun also passed (36.16 s). The four history PNGs
were agent-viewed and their image/timeline hashes checked, bringing the retained
total to **20 inspected PNGs and six hash-checked sanitized timelines**. No raw
traces were retained. The final full-repository format check printed:
`All matched files use Prettier code style!` Typecheck and lint passed again after
the CI corrections.
