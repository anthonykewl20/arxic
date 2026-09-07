# WEB-402-DIFF-VIEWER — OSS visual-regression reference study (Leitir)

Reference study for the dashboard diff-viewer slice. All sources are Leitir-verified
reference shelves (study references, not dependencies); nothing below is installed or
imported by Arxic. Patterns are re-implemented target-natively in React + plain CSS
inside the existing dashboard bundle (no new runtime dependencies), with attribution
recorded in the slice note.

## Sources

| Tool | License | Shelf (repo@commit) | What was studied |
|---|---|---|---|
| BackstopJS | MIT | `garris/BackstopJS@930b3c863d3946fd3c8156166692739479ad51c7` | report UI: scrubber modal, pane toggles, status filters, approve button |
| Argos | MIT | `argos-ci/argos@16e3d740ccbb5cc4f1517f9df2234cc5c0714add` | review workspace: view modes, changes overlay, hotkeys, review loop, sidebar grouping |
| reg-suit / reg-cli | MIT | `reg-viz/reg-suit@5c09c8eb1e356d7e8145e5850e6de17b2b25a5a0`, `reg-viz/reg-cli@da86e239ae6f840c3ea1b532cf2135038736ffac` | self-contained offline report concept; published-baseline workflow |
| jest-image-snapshot | MIT | `americanexpress/jest-image-snapshot@c7e3056b034f8cb60c3016ef18963b0ad8bb127a` | threshold + ignore-region masking semantics |
| Playwright | Apache-2.0 | corpus `microsoft/playwright` (existing shelf) | expected/actual/diff artifact trio in the HTML report |

## Patterns adopted (with source locations)

1. **Detail viewer with view modes.** BackstopJS `ImageScrubber`
   (`compare/src/components/atoms/ImageScrubber.js`) exposes REFERENCE / TEST / DIFF /
   SCRUBBER buttons over one modal; the scrubber is a before/after slider with
   `cursor: ew-resize` and a 5px red divider. Argos formalizes three modes —
   side-by-side, swipe divider, onion blend (`containers/Build/BuildViewMode.tsx`,
   `BlendControls.tsx` `SwipeDivider`). → Arxic: one detail dialog per capture with
   `Side by side | Swipe | Overlay` modes over the existing baseline/current/diff PNG
   artifacts.

2. **Pane visibility + status-filtered list.** BackstopJS `TestImages.js` renders
   Reference/Test panes (Diff only on failure) with per-pane settings toggles;
   `Toolbar`/`ButtonFilter` filter pass/fail and search by name. → Arxic: capture list
   already filters by status/browser/scheme/viewport (keep), plus the viewer consumes
   the existing per-capture `status` (`needs-baseline`/`changed`/`unchanged`).

3. **Approve-as-baseline from the viewer.** BackstopJS `ApproveButton.js` calls
   `approveTest` to promote the current image as reference. Argos `ScreenshotActions` /
   `BuildReviewForm` wrap accept/reject with undo. → Arxic: reuse the existing
   `POST /api/runs/:id/baselines` from the viewer; surface the promoted state.

4. **Keyboard review loop.** Argos `hotkeys.ts` + `BuildReviewUndoHotkeys.tsx`: next/prev
   diff navigation, view-mode and overlay toggles, review undo. BackstopJS `NavButtons`.
   → Arxic (follow-up slice): `j/k` next/prev changed capture, `1/2/3` view modes,
   `a` approve.

5. **Changed-region overlay + jump.** Argos `ChangesOverlay.tsx` paints detected
   changed regions in a reviewer color with `GoToNext/PreviousChanges` buttons.
   → Arxic (follow-up): server already writes a pixelmatch diff PNG per capture
   (`workbench.ts` `compareCapture` → `{capture.id}.diff.png`); a client canvas pass can
   derive region boxes later — the diff PNG itself is the overlay for now.

6. **Threshold/mask semantics.** jest-image-snapshot `failureThreshold` (percentage or
   pixel count) and ignore regions. → Arxic already has project `masks`; a threshold
   editor is a follow-up with engine-side validation.

## Deliberately NOT copied

- BackstopJS's `backstop-twentytwenty` dependency and Argos's Zoomer/minimap/jotai
  stack (dependency graphs stay out; the swipe divider is ~60 lines of target-native
  CSS/TSX).
- Argos diff comments and GitHub PR integration (out of scope for the self-hosted
  dashboard today).
- reg-cli's embedded-report bundling (Arxic serves the dashboard from the workbench
  process; an exportable offline report is a separate future slice).
