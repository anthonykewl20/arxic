# WEB-402-REVIEW-LOOP — staged doc updates (charter §10.2)

Issue: #402 · Disposition: observed implementation (local green; CI on the PR head is the remaining gate — an LLM cannot assign `verified`).

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```text
| #402 | Web product release: comprehensive frontend intent campaigns and AI visual auditing | In progress; changed captures review from the keyboard — j/k walks the changed-capture loop across the gallery and a approves the focused capture as baseline |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```text
| 2026-09-08 | **#402 (WEB-402-REVIEW-LOOP) cross-capture keyboard review loop landed.** The two per-viewer pieces (#475 view modes, #477 region walking) now connect into a capture-level review loop: the run detail keeps a keyboard focus over the run's changed captures — `j` next, `k` previous, both wrapping — marked with `aria-current`, the `capture-reviewing` outline and a scroll-into-view, and `a` approves the focused capture as baseline by clicking that card's own approve action (the exact `data-approve` operational path, no duplicated request logic). Keys are ignored while a modifier is held or focus sits in an input/textarea/select/contenteditable, and typing in the gallery filters normally without consuming loop state. A hint (`data-review-loop-hint`) renders only when changed captures exist. Real-world proof: `review-loop-ui.real-world.test.ts` drives the REAL vulnerable fixture app behind a mutating proxy with two viewports of the same path (two real captures, both baselines approved via the workbench API, then a real run producing two `changed` comparisons): the journey proves `a` with nothing focused approves nothing, the full j/k walk with wrap in both directions, the input-focus guard (key filters, loop state survives the round-trip), `a` approving ONLY the focused card (focused card shows "current approved baseline", the other keeps its button), and a needs-baseline run exposing no loop at all — zero page errors. Red first (hint absent, no `aria-current` ever set). Regressions: diff-viewer, changed-regions, baseline-history, capture-gallery and retention real-browser suites 12/12. Gates local: apps/web typecheck ☑ · repo eslint ☑ · format ☑ (full repo after note); CI on the PR head is the remaining gate. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```text
- WEB-402-REVIEW-LOOP cross-capture review loop (#402): a run's changed captures are walkable from the keyboard — j next, k previous (wrapping), with the focused capture highlighted and scrolled into view — and a approves the focused capture as baseline through the card's existing approve action; keys yield to text inputs and the hint appears only when there is something to review.
```

## 4. `VERSION` bump required?

No — the fold integrator owns `VERSION`; the capability rides the current `0.0.301` line.

## 5. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/review-loop-ui.real-world.test.ts` — real vulnerable fixture app, real mutating-proxy visual regression across two viewports, real workbench runs and baselines, real browser driving the loop and the approval.
- Artifacts: `docs/evidence/WEB-402-REVIEW-LOOP/red.txt` (first red: hint absent) + `green.txt` (3× slice green, 12/12 sibling regressions, gate outputs).
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (slice 1/1 ×3, siblings 12/12) ☑ · license gate → CI.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                       | Expected disposition                                    | Test                                                    |
| --------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| `a` before any capture is focused             | No approval request, both approve buttons intact        | journey pre-focus `a`                                   |
| `j`/`k` on the last/first changed capture     | Wraps to the first/last                                 | journey wrap assertions (both directions)               |
| Keydown while focus is in a gallery input     | Character filters the list normally; loop state unmoved | journey `/` + `j` round-trip                            |
| Approval from the keyboard                    | ONLY the focused capture is approved                    | journey: focused approved, other unapproved             |
| Run with no changed captures (needs-baseline) | No hint, no `aria-current`, j/k/a no-ops, no errors     | journey on the first run                                |
| Modifier combos (ctrl/meta/alt)               | Ignored                                                 | implementation guard (input guard pattern of #475/#477) |
| Page errors during loop/approval              | none collected                                          | journey `errors` assertion                              |
