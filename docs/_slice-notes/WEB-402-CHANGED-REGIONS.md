# WEB-402-CHANGED-REGIONS — staged doc updates (charter §10.2)

Issue: #402 · Disposition: observed implementation (local green; CI pending — an LLM cannot assign `verified`).

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```text
| #402 | Web product release: comprehensive frontend intent campaigns and AI visual auditing | In progress; changed captures expose per-region change boxes (Argos-style overlay with next/previous walking and viewer keyboard shortcuts) |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```text
| 2026-09-08 | **#402 (WEB-402-CHANGED-REGIONS) changed-region overlay and viewer hotkeys landed.** `compareCapture` now also derives display-only `diffRegions` bounding boxes (scanline run-merge over a plain RGB-distance mask, 3px bridge, 4px minimum side, 200-box cap; pixelmatch keeps owning the changed/unchanged verdict), persisted on each compared capture. The DiffViewer renders an opt-in **Changes** overlay of percentage-positioned region boxes over the current image in all three modes, with **Next/Previous change** walking (wrapping), an active-region highlight that scrolls into view, an `N / M` counter, and keyboard shortcuts on the viewer (`1/2/3` view modes, `n`/`p` regions) — the Argos `ChangesOverlay` + hotkey patterns re-implemented target-natively. Real-world proof: `changed-regions-ui.real-world.test.ts` drives the REAL vulnerable fixture app behind a mutating proxy that injects two fixed-position pseudo-element squares: the journey pins the region count (2), the exact geometry in percentages (8.33%/6.67% ±0.6), button and keyboard region walking with `aria-current`, mode shortcuts, and zero page errors; unit pins cover identical images, speck filtering, exact isolated-box coordinates, gap bridging, and the 200-box cap. Red first at `eefc3dab`/`d36b4a72` (no region UI). Regressions: diff-viewer, baseline-history and retention suites 5/5. Gates local: apps/web typecheck ☑ · eslint ☑ · format ☑ (full repo after note); CI on the PR head is the remaining gate. Remaining follow-ups: cross-capture review loop (j/k over changed captures, `a` approve), per-project threshold editor. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```text
- WEB-402-CHANGED-REGIONS changed-region overlay (#402): compared captures record where their pixels changed, and the diff viewer can paint those regions over the current image in every mode, walk them with Next/Previous change (or `n`/`p`), and switch view modes from the keyboard (`1` side-by-side, `2` swipe, `3` overlay) — navigation metadata derived at comparison time; pixelmatch remains the comparison verdict.
```

## 4. `VERSION` bump required?

No — the fold integrator owns `VERSION`; the user-visible capability rides the next integrator fold.

## 5. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/changed-regions-ui.real-world.test.ts` — real fixture app, controlled two-square regression, real workbench runs, real browser driving overlay, walking, and hotkeys.
- Unit pins: `apps/web/src/__tests__/changed-regions.test.ts`.
- Pattern source: Argos `ChangesOverlay`/hotkeys, cited in `docs/evidence/WEB-402-DIFF-VIEWER/references.md`.
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (unit 4/4, journey 1/1, regressions 5/5) ☑ · license gate → CI.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                             | Expected disposition                       | Test                           |
| ----------------------------------- | ------------------------------------------ | ------------------------------ |
| Identical images                    | no boxes                                   | unit pin                       |
| Speck below the 4px minimum side    | filtered out                               | unit pin                       |
| Two squares separated by ≤3px       | merged into one bridged box                | unit pin                       |
| More than 200 regions               | capped at 200, all distinct                | unit pin                       |
| Region overlay before any walk      | boxes visible, none active, counter hidden | journey (`counter.isHidden`)   |
| Keyboard while focus is in an input | shortcuts ignored                          | keydown guard (input/textarea) |
| Page errors during overlay/hotkeys  | none collected                             | journey `errors` assertion     |
