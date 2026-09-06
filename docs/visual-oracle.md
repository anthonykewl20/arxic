# Full visual regression and auditing contract

Owner direction: 2026-09-06. Tracker: [#402](https://github.com/anthonykewl20/arxic/issues/402).
This specifies the target product, not a claim that the implementation already covers it.

The [compact visual-model proposal](./visual-small-model-spec.md) specifies a narrow CPU-trained assistant for six defect families under a small-VPS resource target. Its experimental CLI preserves this contract's hard-check authority and coverage gaps; the initial clipping classifier failed its held-out app test. It does not replace the full taxonomy or establish general model coverage. Codex builds and evaluates the foundation before optional GLM teaching.

## Product boundary

Discover the product, exercise reachable states, capture pictures and read-only
layout/accessibility evidence, measure against independent expectations, and
report reproducible defects and coverage gaps. A pixel change is an observation;
an unchanged baseline is not evidence that the design is correct.

“Complete” always names a frozen scope: source revision, deployment, entry points,
roles, fixtures, flags, locale, browser, viewport, theme and allowed actions.
Arbitrary hidden features and all possible defects cannot be guaranteed.
Discovered states after scope freeze extend the next manifest rather than rewrite
the denominator. Exhausted budgets, unreachable states and unsupported surfaces
remain visible. Coverage is measured on reached states and executed transitions,
not route count alone. Pairwise and prioritized campaigns may reduce matrix cost,
but must disclose omitted combinations rather than claim exhaustive coverage.

## Oracle authority

| Kind    | Decision                                                        | Required evidence                                                                                                       |
| ------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Hard    | Deterministic predicate under a declared applicability profile  | Finite measured values, expectation/version, stable scene and screenshot reference                                      |
| Suspect | Measured candidate plus independently supported grouping/intent | Measurement IDs, candidate group, closed intent classification and its provenance                                       |
| Vision  | Model hypothesis about visual meaning                           | Actually supplied and permitted screenshot, valid scene measurement references, independent criterion, model provenance |

An AI cannot supply or replace measured numbers, waive hard failures, invent
selectors, manufacture execution, or assign the engine truth state `verified`.
Model proposals are untrusted input. Missing IDs, mismatched image/scene hashes,
invalid enums, non-finite numbers and out-of-bounds references reject the claim;
they do not become product failures. An invalid claim remains diagnosable.
Hard checks must still run when the model is unavailable.

Per-check verdicts are `pass`, `fail`, `unverified`; execution dispositions also
report `blocked` and `unsupported-by-runtime`. These are separate from ADR-001's
engine truth states. Fusion preserves hard failures and uses
`fail > unverified > pass`. No checks, no evidence or incomplete coverage cannot
produce an overall pass. Vision output stays hypothesized until independent
confirmation; the supplied brief's competing vision-pass rules are resolved
conservatively: absence of a vision finding never establishes a pass.

Intent proposals use a closed vocabulary such as `peer_should_match`,
`intentional_variable_height`, `not_a_peer_group`, `overlay_allowed_sticky`,
`overlay_allowed_modal`, `cannot_tell`. A proposal cannot itself authorize an
exemption. Keep the source of the expectation, affected nodes and applicability.
An exemption applies only to that predicate and group.

## Capture and scene evidence

Target pipeline: authorized scope → real GUI actions → deterministic capture →
scene IR → hard solvers → proposed groups → suspect/vision review → deterministic
fusion → evidence report and baseline review.

Each checkpoint binds screenshot bytes, scene bytes, step, environment and policy
versions. Preserve viewport/full-page/element/component/overlay capture identity.
Use named before/after and transient checkpoints. Record screenshot geometry in
CSS pixels plus image scale/DPR and document scroll offsets; never silently mix
coordinate spaces. Collect boxes/fragments, clip chains, stacking contexts,
hit-test samples, font metrics and availability, computed styles, token
provenance, accessibility relationships and relevant state. An unavailable
baseline, inaccessible frame, canvas paint or closed shadow root is a gap.

Text, accessible names, URLs, image sources and attributes can contain secrets.
A masked screenshot does not sanitize the DOM or the scene. Project and redact
scene evidence independently, omit field values, retain only necessary metadata,
and keep mask provenance. Raw trace ZIPs remain prohibited. A timeline proves
action order; it is not a substitute for DOM/a11y evidence. Video needs its own
capture/redaction and inspection boundary; PNG masks do not mask video frames.

Capture stabilization must cover fonts, decoded images, animation policy, caret,
clock/randomness and live regions without changing business behavior. Document
which interventions were applied and unsupported. A separate temporal campaign
must audit motion before freezing it. Equal before/after observations bound
scene consistency but are not an atomic browser snapshot or proof of intervening
stability. Do not inject application state to reach a test step.

## Defect inventory and required evaluators

Every family below needs positive applicability, negative controls, real-browser
proof, named evidence, explicit uncertainty and reproduction. Not yet implemented
families stay unverified.

| Family                     | Checks and evidence                                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout and geometry        | Edge/center/baseline alignment; spacing/token rhythm; intended symmetry; card/grid size; overflow/clip chains; paint occlusion; hit-box versus paint; stacking; safe areas; nested scrollports |
| Responsive                 | Intermediate widths, container queries, touch versus hover, nav/table/tab reflow, orientation, short viewports, virtual keyboard, zoom, print and DPR                                          |
| Typography                 | Actual font availability, glyph/tofu paint, hierarchy and tokens, line height, measure, wrapping/truncation, baselines, numbers, tracking, i18n expansion                                      |
| Color and surfaces         | Contrast and applicability, compositing, color-only signals, dark/forced-colors, token drift, gradients, elevation, selection and focus paint                                                  |
| Images and media           | Load/decode failure, crop and focal point, aspect, resolution, icon consistency, logos, video controls, canvas/WebGL/maps, chart axes/labels/legends                                           |
| Components and interaction | Buttons/forms/validation, overlays/focus restoration, navigation/wayfinding, lists/tables/virtualization, widgets, upload, drag, scrolling and keyboard                                        |
| Forgotten states           | Loading/empty/sparse/dense/overflow/error/partial/stale/success/readonly/denied/offline/timeout/expired/onboarding/flag-off; hover/focus/active/selected/indeterminate                         |
| Motion and temporal        | Feedback, transient durations, layout shifts, font/theme/hydration flashes, route transitions, reduced-motion applicability and animation jank                                                 |
| UX and heuristics          | Nielsen status/control/consistency/prevention/recovery/help; Gestalt proximity/grouping; affordances, choice density, recognition, wayfinding, content UX and dark-pattern hypotheses          |
| Accessibility              | Names and visible labels, keyboard order/traps/focus visibility, text/non-text contrast, target spacing, reflow/text spacing, error/status semantics, captions and media controls              |
| Internationalization       | Expansion, plural and number/date/currency formats, mixed languages, RTL directional intent, CJK wrapping/fonts and address assumptions                                                        |
| Visible performance        | LCP/CLS context, image/font/loading delays, theme/FOUC/hydration flashes and scroll/interaction jank                                                                                           |
| Platform/environment       | Chromium/WebKit/Gecko, native OS differences, headed/headless, mobile/PWA/WebView, extensions, print/email when explicitly supported                                                           |
| Trust/legal visuals        | Visible secret/stack exposure, consent hierarchy, misleading badges/dialogs, mixed-content failures and supplied legal/brand requirements                                                      |
| Design system              | Token/variant/density/elevation/icon consistency, internal/error pages, debug remnants, duplicate headings and print/PDF layout                                                                |
| Content correctness        | Chart/caption, price/summary, filter/results, tab/panel, stepper/state, count/items, toggle/state, image/title and stale/invalid rendered values                                               |

Opinion-only findings must be labelled as opinions, with no defect verdict.
Brand-specific aesthetics need a written criterion. Marketing asymmetry,
intentional masonry and unequal content do not fail by default.

## Measurement corrections and applicability

- **Contrast:** WCAG large text is 3:1, ordinary text 4.5:1. Do not round a failing
  ratio up. Account for exceptions and actual foreground/background composition.
  Anti-aliased edge pixels are not the normative foreground color. A CSS pair on
  a gradient/image/blend cannot establish painted contrast; report unavailable
  evidence until compositing is resolved. [W3C contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
- **Targets:** WCAG 2.5.8 uses a 24×24 CSS-pixel target or centered 24px-diameter
  spacing circles, with inline/equivalent/UA/essential exceptions. Nearest-edge
  distance ≥24 is not the criterion. Bounding rectangles alone do not prove a
  nonrectangular clickable region. [W3C target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
- **CLS:** use the largest session window (up to five seconds, separated by a
  one-second gap), with recent-input exclusions. Summing all lifetime shifts is
  incorrect. Skeleton IoU is a separately labelled heuristic, not CLS.
  [CLS definition](https://web.dev/articles/cls).
- **Baseline:** `Range.getClientRects()` returns rectangles, not glyph baselines.
  Font/canvas metrics are estimates unless correlated with actual layout. Missing
  baseline evidence must not become a guessed measurement.
- **Overlap:** AABB intersection is a candidate, not proof of occlusion. Ancestor
  boxes, transparent padding, nonrectangular clips, top-layer dialogs and intended
  overlays need paint/hit-testing and semantics. An intercepted center alone does
  not prove every action is inaccessible.
- **Alignment/symmetry:** median deviation and Hausdorff distance measure a stated
  relationship. They cannot establish intended peers or symmetry. Alpha centroid
  is not universally equivalent to perceived optical centering. DPR tolerance is
  a versioned profile, not a universal correctness theorem.
- **Spacing/type/tokens:** a 3× proximity ratio, 35–80ch measure, 8px grid or fixed
  ramp is an optional design-system policy. No policy means suspect/opinion, not
  hard failure. Resolve tokens and allowed one-offs before enforcing membership.
- **Reduced motion/color-only:** not all opacity animations are prohibited, and
  luminance differences alone do not decide whether color carries sole meaning.
  Applicability and alternative signifiers need evidence.
- **Responsive:** document overflow and element offscreen bounds are different.
  Intentional scrollports and hidden/off-canvas controls are not global reflow
  violations. Viewport resizing is not a proof of native browser zoom or mobile
  virtual-keyboard behavior.
- **Pixels:** preserve unexplained paint changes for review even if geometry is
  unchanged; colors, icons and content can regress without moving boxes. Only
  specifically justified noise exclusions may suppress a diff region.

## Campaign matrix

Requested profiles cover widths 320/360/375/390/414/768/1024/1280/1440/1920+,
portrait/landscape, zoom 100/200/400, DPR 1/2/3, Chromium/WebKit/Gecko,
light/dark/high-contrast/forced-colors/reduced-motion/reduced-transparency/print,
en plus long-word/CJK/RTL locales, guest/user/restricted/admin roles,
empty/one/typical/max/ugly data, default/hover/focus/open/loading/error/disabled
states, and first/client/refresh/back/deep-link/post-overlay entries.

Runtime support and profile equivalence must be declared (emulated WebKit is not
an iOS-device certification). Surface inventories include routes/query/hash/deep
links, regions, components, flags/variants, role gates, hidden reachable controls,
404/500, print, PWA and optional email/OG surfaces. Exercise only actions allowed
by the project's policy, with bounded state exploration and fixture isolation.

## Finding contract

A finding records stable ID, class, severity (blocker/major/minor/nit), kind,
verdict, predicate/profile/version, expected value and authority, measured values
and IDs, screenshot/scene hashes, affected regions, reproduction steps, route,
viewport/browser/theme/locale/role/data/state, console/page-error association,
exemption provenance and truth-state disposition. Separate product defects,
locator errors, environment failures, known overlays and model errors.

Baseline approval records reviewer, branch/revision and compatible environment;
it does not waive a failing independent predicate. Review screens must expose
coverage and unverified checks alongside visual differences.

## Delivery sequence and current boundary

1. **Evidence foundation (this slice):** numeric-only bounded layout projection,
   before/after scene consistency checks, hash-linked assessment artifact and
   deterministic document-horizontal-overflow predicate. Other families are
   explicit unverified entries. Existing screenshot-only AI review remains a
   separate hypothesis path; it is not the new fusion engine.
2. **Applicable scene solvers:** clip chains, stacking/hit tests, composited
   contrast, declared alignment groups, tokens/font metrics. Each solver gets
   independent numeric examples, negative controls and real-app browser proof.
3. **State discovery/execution:** source/runtime inventory fusion, observed
   GUI-action FSM, personas/flags/data shapes, transient checkpoints and coverage
   denominator. Preserve blocked actions without bypassing through JS.
4. **Constrained model review:** validated group proposals and intent enums,
   scene-bound image claims, vision capability canary, deterministic fusion with
   hard-failure precedence, invalid-claim diagnostics, no model-generated pass.
5. **Matrix/regression/UX:** additional browsers/profiles, temporal capture,
   baseline branches/masks, perceptual/structural diff mapping and full taxonomy.
6. **Release proof:** replayable reference-app and independent live-product
   campaigns, current-head CI pass, safe evidence plus independent human screenshot
   inspection, runtime/retention/distribution checks. #402 stays open until its
   full acceptance criteria are met.

No paid model inference, new video recording, complete scene/a11y tree,
full-page capture, contrast/alignment/overlap solver, matrix execution or new
AI fusion is claimed by the evidence foundation.

The dashboard now exposes each retained numeric assessment under **Measured checks and coverage**, with expected predicates, measurement IDs, deltas, unverified gaps, JSON download and unavailable/retry handling. [Dashboard audit evidence](evidence/WEB-402-DASHBOARD-UX/summary.md) tests that presentation and its recovery path; it does not expand the foundation's detector coverage. Continuous unmasked video is refused, including legacy enabled configurations.
