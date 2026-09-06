# Solid text contrast and measured-region inspector — WEB-402-CONTRAST

This is scoped implementation proof, not completion of #402 or production-release certification. Final-head CI and merge disposition are recorded in the linked PR.

## What changed

The visual capture job now records a numeric-only text-paint projection and runs a deterministic solid-paint contrast predicate. Ratios are not rounded before comparison: ordinary text requires 4.5:1; large text requires 3:1 at 24 CSS px or 56/3 CSS px with weight at least 700. Supported results include measured ratio, threshold, delta, viewport-space region and measurement IDs. Overall incomplete coverage never becomes a pass, and model output cannot waive numeric failures.

The dashboard provides measurement search, verdict filters, region lookup on the retained masked screenshot, image loading/error/retry, and a full-size capture link. Mobile rendering preserves the capture's coordinate system. Display rounding is labeled and does not affect the server verdict.

## Real proof and boundaries

- `contrast/`: actual Express reference-app responses with an explicit CSS variant. The white baseline measures 13 supported text pairs. The red/near-red regression includes an effectively invisible heading (~1.000509:1 against its 3:1 threshold), ordinary text failures, and the pre-existing overflow assertion. Approved-baseline preservation and tampered image/assessment rejection remain checked.
- `dashboard/`: actual workbench Chromium journeys in light and dark themes. Public GUI onboarding, discovery, visual jobs, approval, schedules and session/error cases remain covered. The measurement journey additionally injects an image-load failure, retries it, searches/filters checks, validates the actual retained pixels and checks the mobile region preview.
- `inspector/`: real Express reference app with a separate `#ccc` heading on white. The inspector must show its ~1.605929:1 ratio as 1.606 for display, the independent 3:1 threshold, one failed check, and its screenshot region on desktop/mobile. Fixture project/run setup uses the public authenticated API; this focused test does not claim GUI onboarding.
- Supplemental synthetic browser and pure-math tests exercise threshold boundaries, opacity/gradients/pseudo paint/occlusion/masks, malformed data, numeric projection and the collection budget. They supplement the real-app proof.

The collector does not retain DOM text, attribute values, field values, selectors, URLs or font-family names. Scene and screenshot evidence remain separately projected and hash-linked. Before/failure-era images are explicitly separate from passing final proof. Raw traces and videos are not retained.

## Validation record

Implementation: `fa6547d`. Final local web run: **72 tests / 21 files passed**, 430.83 seconds.

Earlier evidence matters: the first full web run at `8dfe5bb` passed 70/71 tests and saw two reset emails where the existing agent test requires at least three. An unchanged focused rerun passed. [Issue #422](https://github.com/anthonykewl20/arxic/issues/422) retains the unexplained discrepancy; no count assertion was reduced. This is not an error-free E2E claim.

Image inspection found a blank dark SVG preview despite passing DOM checks. That exact spontaneous blank was not reproduced in subsequent focused runs. An injected image failure separately proved missing feedback. Native image load/error/retry, a painted-image guard on retained screenshots, and final screenshot inspection now cover the new presentation. The full-size link initially failed the 24px target check; its hit area was corrected without changing the assertion.

The isolated `tsx` job exposed browser callback closure injection that standalone Vitest did not. Serialization-safe anonymous helpers corrected it, and the real capture test exercises that path. Test fixture corrections gave independent synthetic text rows unique IDs and moved the occlusion control inside its opaque parent; verdict expectations were not widened. A new axe test required an explicit browser context; no accessibility rule was excluded.

Static gates: lint, root/package typechecks and license. Full-repo format after the completed slice note: `All matched files use Prettier code style!`. Required current-head CI is separately linked in the PR.

## Remaining scope

This profile requires opaque sRGB direct HTML text and an explicit opaque ancestor background. Unsupported compositing, gradients/images, partial alpha, masks, clipping/rounded paint, font uncertainty, non-ancestor intersections, pseudo paint, filters/shadows and exhausted collection budgets stay unverified. Implicit canvas backing, SVG/canvas/shadow DOM/frame/placeholder text, decorative/logotype intent and full WCAG certification are not inferred. See the [profile contract](../../visual-oracle.md#solid-text-contrast-profile).

The complete state/persona/flag/browser matrix, broader deterministic detectors and business-intent mapping, model/profile execution proof, operational retention/distribution and required human inspection remain open under #402. Understand Anything's reviewed source-adapter integration already exists; this slice introduces no copied upstream code. Integrator notes remain due before milestone exit. No release is tagged or published and no LLM assigns `verified`.

Retained inventory: 38 final PNGs plus one explicitly identified before/failure image; six sanitized timelines and adjacent hash provenance; 35 dashboard audits with zero reported violations, incomplete entries or horizontal overflow. [Artifact index](artifact-index.json). Agent image review is distinct from the required human release inspection.
