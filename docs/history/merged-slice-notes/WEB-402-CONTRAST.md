# WEB-402-CONTRAST — staged integration notes

Issue: #402. Disposition: observed implementation; full production goal remains open.

## 1. SYNC tracker row

```text
| #402 | Full visual tester: solid-paint text contrast and screenshot region lookup | In progress; contrast profile has explicit unsupported-paint gaps |
```

## 2. SYNC session-log row

```text
| 2026-09-06 | WEB-402-CONTRAST adds numeric text-paint evidence, unrounded contrast thresholds and dashboard region lookup. Real reference-app capture reproduces a low-contrast variant without replacing the approved baseline. Unsupported paint and masked text remain unverified; full #402 and release gates remain open. |
```

## 3. CHANGELOG entry

```text
- Added (refs #402): solid-paint text contrast measurements, numeric ratio/threshold evidence, verdict/search filters and screenshot region lookup. Preserve unknown paint, privacy masks and budget stops as unverified; no model can waive numeric failures.
```

## 4. VERSION bump

User-visible capability. Integrator folds WEB-402-ORACLE, WEB-402-DASHBOARD and this note in merge order and applies the owner-defined version rule. This worktree does not change VERSION, SYNC or CHANGELOG.

## 5. Evidence and gates

Real Chromium reference-app regression plus synthetic boundary cases and dashboard light/dark journeys. The [scoped audit](../evidence/WEB-402-CONTRAST/summary.md) contains 38 final screenshots, one before image and six sanitized timelines. Final local web suite: 72/72 tests across 21 files; current-head CI is recorded in the PR. Full-repo format after this note: `All matched files use Prettier code style!`. The first full web run passed 70/71; its unchanged reset-mail assertion failure is tracked in #422. Focused rerun passed but did not explain it. Screenshot inspection found one blank SVG preview; native image load/error/retry and painted-image guards now supplement DOM assertions. Final-head test/CI results are recorded in the attached audit and PR. No assertion tolerance was widened, and no human release inspection is claimed.

## 6. Sad paths

| Trigger                                       | Expected result                                      | Test                                         |
| --------------------------------------------- | ---------------------------------------------------- | -------------------------------------------- |
| Ratio below threshold before rounding         | Hard fail                                            | text-contrast.test.ts                        |
| Malformed/unstable numeric evidence           | Unverified or collection rejection                   | text-contrast.test.ts, visual-oracle.test.ts |
| Masks/opacity/gradients/occlusion             | Unverified paint                                     | text-paint.test.ts                           |
| Low-contrast reference-app variant            | Captured numeric fail, approved baseline preserved   | visual.test.ts                               |
| Missing/hash-changed assessment               | Error/retry or integrity refusal                     | ui.real-world.test.ts, visual.test.ts        |
| Serialized callback under isolated tsx worker | Same real capture succeeds; no hidden helper closure | visual.test.ts                               |
