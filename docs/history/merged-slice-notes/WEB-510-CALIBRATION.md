# WEB-510-CALIBRATION — staged doc updates (charter §10.2)

Issue: #510 · PR: (filled at PR creation) · Disposition: mixed (calibration properties verified; one proposed stronger real-journey pin was disproved by the real fixture and withdrawn — disclosed below)

## 1. `docs/SYNC.md` — RESUME-note sentence

```
Diff-explanation calibration landed (#510): determinism/geometry properties pinned, the trivially-true UI assertion replaced by a server-UI consistency check, and a proposed Heading pin honestly withdrawn after the real fixture disproved it (full-viewport regions saturate the 5-element cap with depth-first ordering — recorded as a ranking follow-up).
```

## 2. `docs/SYNC.md` — session-log row (append)

```
| 2026-09-09 (7) | **#510 (WEB-510-CALIBRATION) diff-explanation calibration DONE.** Determinism properties pinned (repeat invocation deep-equal; shuffled scene-node input ⇒ identical output), geometry edges pinned (shared-edge zero-area contact excluded; 1px overlap included at honest 0.01 coverage; containment = 1; 3-decimal rounding). The one trivially-true UI assertion (`unexplained ≤ evidence count`) was replaced by a real server-UI consistency check (each rendered `data-region-evidence` mirrors the stored explanation's `unexplained` flag for the same index). A stronger real-journey pin ("a Heading-kind element is always attributed in the visual.test.ts regression") was attempted, FAILED against the real fixture — that journey's full-viewport background change forms one region whose 5-element cap fills with the deepest nodes, so the heading does not rank — and was withdrawn per the issue's own AC-3 with the finding disclosed (candidate follow-up: coverage-first ranking for regions covering most of the viewport). Test-only slice; no product change, no matcher widened. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### internal`

```
- WEB-510-CALIBRATION diff-explanation accuracy calibration (#510): pinned determinism (identical output on repeat and on shuffled scene input), shared-edge exclusion, one-pixel-overlap inclusion with honest coverage, and coverage rounding bounds; replaced the one trivially-true dashboard assertion with a server-UI consistency check that each rendered region entry mirrors the stored explanation; withdrew a proposed stronger journey pin after the real fixture disproved it, disclosing the full-viewport region ranking limitation instead.
```

## 4. VERSION bump required?

no — test-only, not user-observable.

## 5. Evidence pointers

- Unit: `apps/web/src/__tests__/diff-explanation.test.ts` — 10/10 (3 new property tests).
- Real-world: `apps/web/src/__tests__/diff-evidence-ui.real-world.test.ts` (strengthened consistency check, 1/1); `apps/web/src/__tests__/visual.test.ts` journey re-verified green after the honest pin withdrawal.
- Gates: typecheck + typecheck:packages ☐ · lint ☐ · format:check ☐ (last line in the PR) · full apps/web suite on main ☐ · required `ci` ☐

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                      | Expected disposition                                             | Test                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------- |
| Shared-edge (zero-area) node contact                         | not an intersection; region unexplained                          | diff-explanation.test.ts            |
| 1px true overlap                                             | included, coverage 0.01 exactly                                  | diff-explanation.test.ts            |
| Repeated invocation / shuffled input order                   | byte-identical output (determinism)                              | diff-explanation.test.ts            |
| Rendered dashboard evidence diverges from stored explanation | consistency check fails                                          | diff-evidence-ui.real-world.test.ts |
| Proposed stronger pin disproved by real capture              | pin withdrawn + limitation disclosed (contradicted → documented) | this note + issue comment           |
