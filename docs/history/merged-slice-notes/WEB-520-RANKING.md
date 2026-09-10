# WEB-520-RANKING — staged doc updates (charter §10.2)

Issue: #520 · PR: (filled at PR creation) · Disposition: verified (boundary unit red-first; the withdrawn #510 journey pin re-landed and now passes against the real fixture)

## 1. `docs/SYNC.md` — RESUME-note sentence

```
Large-region ranking landed (#520): diff-explanation regions covering >= 60% of the viewport rank elements coverage-first, converting the disclosed #510 limitation (full-viewport repaints never surfacing the repainted element) into pinned behavior — the withdrawn Heading journey pin now holds against the real fixture.
```

## 2. `docs/SYNC.md` — session-log row (append)

```
| 2026-09-09 (8) | **#520 (WEB-520-RANKING) large-region coverage-first ranking DONE.** `explainDiffRegions` gains a deterministic two-mode ordering: regions covering >= 60% of the viewport area rank intersecting elements by coverage desc (depth, then id as tiebreaks); smaller regions keep depth-first. Red-first boundary pin: 800x360 over an 800x600 viewport (exactly 0.6) flips to coverage-first with full-order assertion [Region, Heading, Button]; 800x359 stays depth-first (Button first). The #510-withdrawn Heading journey pin was re-landed and now PASSES on the real Chromium regression journey — the full-viewport repaint attributes the measured Heading node. All #510 calibration properties unchanged (determinism incl. shuffled input, shared-edge exclusion, 1px overlap, rounding); diff-evidence UI journey green; no assertion widened. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### changed`

```
- WEB-520-RANKING large-region ranking in diff explanations (#520): a changed region covering 60% or more of the viewport area now ranks intersecting measured elements by coverage first (depth and id as deterministic tiebreaks) instead of innermost-first, so full-page repaints attribute the actually-repainted large element rather than filling the element cap with the deepest nodes; smaller regions keep the innermost-first order. The previously-disclosed limitation is now pinned behavior: the real regression journey attributes its measured Heading node.
```

## 4. VERSION bump required?

no — rides the unreleased v0.0.400 wave (user-observable refinement of the #508 capability folded in the same batch window); integrator's call if a further bump is preferred.

## 5. Evidence pointers

- Unit: `apps/web/src/__tests__/diff-explanation.test.ts` — 11/11 (new boundary test red-first).
- Real-world: `apps/web/src/__tests__/visual.test.ts` (re-landed Heading pin, real Chromium, green) and `apps/web/src/__tests__/diff-evidence-ui.real-world.test.ts` (1/1 unchanged).
- Gates: typecheck + typecheck:packages ☐ · lint ☐ · format:check ☐ (last line in the PR) · required `ci` ☐

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                             | Expected disposition                           | Test                                |
| ----------------------------------- | ---------------------------------------------- | ----------------------------------- |
| Region area exactly 60% of viewport | coverage-first ordering (exact arithmetic)     | diff-explanation.test.ts            |
| Region area 59.83% (< 60%)          | depth-first ordering preserved                 | diff-explanation.test.ts            |
| Full-viewport real repaint          | repainted element ranks (Heading attributed)   | visual.test.ts real journey         |
| Small-region behavior change        | none — depth-first unchanged, UI journey green | diff-evidence-ui.real-world.test.ts |
| Determinism under the new mode      | properties unchanged, shuffled input identical | diff-explanation.test.ts            |
