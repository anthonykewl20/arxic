# WEB-454-DENSITY — staged doc updates (in progress)

Issue: #454 · PR: not opened · Disposition: scoped local checks pass after reproducing/fixing native shell drift; required final-head CI remains pending.

## 1. `docs/SYNC.md` — tracker row

```
| #454 | [WEB-454-DENSITY] Native pixel-density matrix and dashboard review | ☐ in progress; local proof passes, CI pending |
```

## 2. `docs/SYNC.md` — session-log row

```
| 2026-09-07 | **#454 (WEB-454-DENSITY), in progress.** Add native 1×/2×/3× capture identity, bounded project admission, dashboard selection/filtering and CSS-coordinate element picking. Real browser proof exposes native Chromium text-paint drift, a clipped settings error, unsupported density review filenames and mis-scaled AI overlays. No pixel assertion is weakened. UI fixes and review integration are locally exercised; full Chromium native repeatability now passes; installed final-head CI and full #402 remain unfinished. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### Added`

Stage only after acceptance and CI pass:

```
- WEB-454-DENSITY (refs #454): add native pixel-density matrices, independent baseline identities and capture filters. Keep element measurements in CSS pixels and AI finding overlays in image pixels. Refuse oversized captures and bring project validation errors into view. Native Chromium uses the full headless renderer with explicit baseline identity after reproducing a shell-only raster defect. AI image-size refusals offer actionable recovery. Reuse real sign-in state within each browser family of a run to avoid matrix-driven login-rate limiting; discard it between runs. Required final-head CI remains the completion gate.
```

## 4. `VERSION` bump required?

Yes, user-observable functionality. Integrator selects the next synchronized version after completion; this worktree does not edit VERSION, CHANGELOG or SYNC.

## 5. Evidence pointers

- `apps/web/src/__tests__/visual-density.real-world.test.ts`: actual reference app, Chromium/Firefox/WebKit, nine native environments; two fresh baseline/repeat/2×-only-regression runs pass with full Chromium at high density.
- `visual-density-ui.real-world.test.ts`: actual dashboard/reference app; empty/oversized settings, keyboard selection, responsive density filtering and independently measured 2× element picking.
- `visual-density-review.real-world.test.ts` and existing visual review tests: actual capture integrity and model image limits; provider responses use an explicit local boundary, not paid-model inference.
- `visual-review-ui.real-world.test.ts`: existing authorization/pending-review journey also runs at native 2× with an exact image-coordinate overlay assertion.
- [Current follow-up proof](../evidence/WEB-454-DENSITY/followup.md) and [historical partial proof](../evidence/WEB-454-DENSITY/summary.md) includes named masked images, adjacent provenance, sanitized timelines and the original failing native repeat pair. Final-head CI and complete slice acceptance remain owed. No human inspection or release sign-off is claimed.

## 6. Sad paths proved

| Trigger                                                   | Expected disposition                             | Proof                                               |
| --------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------- |
| Empty, duplicate, malformed or unsupported density        | Reject                                           | Project admission tests and real empty-selection UI |
| Viewport × density exceeds PNG pixel bound                | Reject with recoverable visible error            | Admission and real dashboard                        |
| Density filter has no matching capture                    | Empty result; unchanged run evidence             | Selection contract                                  |
| AI review filename contains unsupported density/traversal | Refuse before reading                            | Review image contracts                              |
| Native image exceeds model pixel bound                    | Refuse without relaxing image policy             | Real 3× reference-app capture                       |
| Review overlay uses CSS dimensions on native pixels       | Contradicted before fix                          | Real 2× review UI                                   |
| Settings error extends behind dialog footer               | Contradicted before fix                          | Real light/dark geometry assertion                  |
| Repeated native capture changes text pixels               | Reproduced in shell; full-headless repeat passes | Nine-environment baseline/repeat test               |

Eighteen authenticated Next.js cells pass with the target rate limits unchanged; a later bad-credential run produces zero captures across all eighteen cells. The original failure was two Firefox dark cells exhausting the ten-per-minute login bucket.

Remaining: full installed engine proof after all edits, complete attached evidence and exact-head CI; broader locale/zoom/state/role/heuristic matrices and full #402 are not complete. Experimental font-size checks, hinting flags, paint-order and GPU-off probes did not establish a fix and are not shipped. A larger plain-capture control disproved the earlier collector-only hypothesis; full Chromium produced one hash across 32 fresh probes. No assertions were loosened; the inspector's missing-details click was a test-flow correction.
