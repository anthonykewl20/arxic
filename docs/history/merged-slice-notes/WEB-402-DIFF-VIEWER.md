# WEB-402-DIFF-VIEWER — staged doc updates (charter §10.2)

Issue: #402 · Disposition: observed implementation (local green; CI pending — an LLM cannot assign `verified`).

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```text
| #402 | Web product release: comprehensive frontend intent campaigns and AI visual auditing | In progress; changed captures compare through an interactive diff viewer (side-by-side, swipe, overlay) with approve-as-baseline on the card |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```text
| 2026-09-08 | **#402 (WEB-402-DIFF-VIEWER) interactive visual diff viewer landed.** Every capture card's static three-pane grid became a `DiffViewer` (`apps/web/src/frontend/diff-viewer.tsx`, target-native React + CSS, zero new runtime dependencies): a comparison region with **Side by side / Swipe / Overlay** modes — swipe stacks baseline+current with a draggable, keyboard-operable divider (`role="slider"`, arrow keys ±5, pointer capture drag, `cursor: ew-resize`), overlay is an onion-skin with an opacity range, side-by-side keeps the two full images plus the pixel-difference figure; needs-baseline captures keep the plain capture/diff figures with their explanatory placeholders, and the Approve-as-baseline action stays on the card. Pattern sources studied as Leitir references (not dependencies) and cited in `docs/evidence/WEB-402-DIFF-VIEWER/references.md`: BackstopJS `ImageScrubber` scrubber modal (garris/BackstopJS@930b3c86), Argos swipe/onion view modes and review controls (argos-ci/argos@16e3d740), reg-cli self-contained report, jest-image-snapshot mask semantics. Real-world proof: `diff-viewer-ui.real-world.test.ts` drives the REAL vulnerable fixture app through a mutating proxy (controlled visual regression): run 1 → baseline approved → proxy change → run 2 → 'changed' capture with a diff artifact; the real dashboard then exercises keyboard divider moves (50→45→55), a pane-relative pointer drag (→20 with the clipped image's style changing), overlay opacity 0.3 applied to the top image, side-by-side image alt-roles, the pixel-difference figure, and the approve button, with zero page errors. Red first at `8b39aee9` (no 'Visual comparison' region existed). Regressions: baseline-history, capture-gallery and retention real-browser suites 6/6 unchanged. Gates local: apps/web typecheck ☑ · eslint ☑ · format ☑ (full repo after note); CI on the PR head is the remaining gate. Follow-ups recorded in the reference study: changed-region overlay with jump-to-change, keyboard review loop (j/k next changed capture, 1/2/3 modes), threshold editor. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```text
- WEB-402-DIFF-VIEWER interactive visual diff viewer (#402): capture comparisons move from a static image grid to a review viewer with Side by side, Swipe (draggable + keyboard divider) and Overlay (onion-skin opacity) modes over the existing baseline/current/diff artifacts — pattern-matched on BackstopJS's scrubber and Argos's view modes, implemented natively with no new dependencies; approve-as-baseline remains one action away.
```

## 4. `VERSION` bump required?

No — the fold integrator owns `VERSION`; the user-visible capability rides the next integrator fold of the current `0.0.301` line.

## 5. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/diff-viewer-ui.real-world.test.ts` — real fixture app, real mutating proxy regression, real workbench runs, real browser driving keyboard and pointer interactions.
- Reference study: `docs/evidence/WEB-402-DIFF-VIEWER/references.md` — Leitir-verified sources with repo@commit identities and the adopted/not-copied decisions.
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (viewer 1/1 + regressions 6/6) ☑ · license gate → CI.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                         | Expected disposition                                                  | Test                                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| No 'Visual comparison' region on pre-slice main | red at `8b39aee9` (timeout)                                           | red commit                                                                      |
| needs-baseline capture (no baseline image)      | Mode buttons hidden; capture + explanatory placeholder figures render | DiffViewer `comparable` guard (covered by gallery suite's needs-baseline cards) |
| Divider keyboard operation                      | ArrowLeft/Right move by 5 within 0–100 bounds                         | journey assertions 50→45→55                                                     |
| Divider pointer drag                            | Pane-relative drag moves position; clipped image style changes        | journey drag → 20                                                               |
| Overlay opacity input                           | Top image opacity tracks the range (0.3 at 30)                        | journey assertion                                                               |
| Page errors during mode switching               | none collected                                                        | journey `errors` assertion                                                      |
