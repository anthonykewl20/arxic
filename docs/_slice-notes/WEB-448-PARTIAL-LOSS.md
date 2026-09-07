# WEB-448-PARTIAL-LOSS — staged doc updates

Issue: #448 · Branch: `fix/capture-loss-448` · Disposition: partial-result-loss class fixed and proven; closure gated on exact-head CI

## 1. `docs/SYNC.md` — tracker row

| #448 | Missing healthy capture in blocked-page matrix | Environment-level partial-result loss fixed red-to-green; exact-head CI pending |

## 2. `docs/SYNC.md` — session-log row

2026-09-07 (3): #448 root cause established at the mechanism level — environment-level throws (launch/context/timeline write or read-back) discarded that environment's completed captures with no failure phase, matching the five-of-six CI signature. EISDIR injection at an environment timeline destination reproduces it deterministically (red: 1 of 2 healthy captures, zero findings). Fix: non-discarding timeline writes with a `timeline-write-failed` finding (`evidence-write` phase), guarded run-level read-back, per-page `environment` phase for context/page creation, launch-only environment catch. Green on three engines; gallery/write-isolation/capture-failures regressions unchanged; installed acceptance grows to nineteen files.

## 3. `CHANGELOG.md` — entry under `## [Unreleased]`

- Retain every completed capture when an environment-level failure strikes mid-matrix: timeline write loss classifies as `timeline-write-failed` with an attributed cell reason instead of discarding the environment's captures; run-level timeline read-back no longer discards a faulty environment; context/page creation failures record a per-page `environment` phase. The original five-of-six CI capture loss is explained by this class and any recurrence self-identifies (refs #448).

## 4. `VERSION` bump required?

Yes, user-visible evidence-retention behavior; integrator owns the fold. No VERSION mutation in this worktree.

## 5. Evidence pointers

- `docs/evidence/WEB-448-CAPTURE-DIAGNOSTICS/partial-loss/`: red (EISDIR injection, 1-of-2 captures, zero findings) and green (chromium 7.68 s / firefox 11.68 s / webkit 7.98 s; both captures retained, loss attributed to the firefox cell). Manifest rehashed (121 files); masked screenshots with adjacent provenance; no raw traces.
- Regressions unchanged: capture-write-isolation chromium 11.00 s; capture-failures 32.86 s; capture-gallery light/dark 61.67 s / 60.70 s with the original six-capture assertions.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                 | Expected disposition                                                                      | Test                                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Environment timeline destination faults after a capture | Capture retained; `timeline-write-failed` finding; blocked outcome with attributed reason | Real EISDIR injection, three engines                                         |
| Run-level timeline read-back of a faulty environment    | Merge skipped; captures and findings preserved                                            | Same injection exercises the read-back                                       |
| Context/page creation failure mid-matrix                | Per-page `environment` phase; siblings retained                                           | Same retention architecture (no deterministic real injection — explicit gap) |
| Healthy sibling environment                             | Observed with its capture, unaffected                                                     | Same journey                                                                 |

Remaining: exact-head required CI (all gates incl. installed partitions over nineteen files), integrator fold. The specific one-run CI trigger cannot be re-observed; recurrence now self-identifies. No production-readiness claim.
