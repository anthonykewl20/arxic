# WEB-439-MATRIX — staged doc updates

Issue: #439 · PR: linked from issue · Disposition: scoped observed local proof;
required current-head CI is recorded in the PR before merge. #402 remains open.

## 1. `docs/SYNC.md` — tracker row

Fold after required CI passes and the slice merges:

```
| #439 | [WEB-439-MATRIX] Browser/theme/viewport visual capture matrix | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row

```
| 2026-09-07 | **#439 (WEB-439-MATRIX)** configure Chromium/Firefox/WebKit × light/dark × viewports; shared capture budget, per-environment blocked/omitted outcomes and independent baselines. Real 12-cell repeat/dark-regression proof and six authenticated Next.js environments pass. WebKit color-marker normalization preserves pixel chunks and strict retained-PNG validation. Final dashboard proof and current-head CI are recorded in the PR/issue. Full #402 and human release inspection remain open. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### Added`

```
- WEB-439-MATRIX (refs #439): add dashboard-configured browser/theme visual matrices with independent baseline identities, environment-specific outcomes/findings and shared-budget omissions. Support actual WebKit viewport PNGs by removing validated fixed color markers without changing encoded pixels or loosening retained PNG validation.
```

## 4. `VERSION` bump required?

Yes, user-observable coverage and controls. Integrator selects the next synchronized
VERSION/package version while folding deferred notes. This worktree does not edit
shared globals; current package/dashboard version remains 0.0.200.

## 5. Evidence pointers

- [Safe proof](../evidence/WEB-439-MATRIX/summary.md): real browser/theme/viewport comparisons, authenticated Next.js captures and dashboard interaction journeys.
- Engine/auth implementation and initial proof at clean commit `53443eb`; dashboard touch-target/framing follow-up is separately identified in the proof summary.
- Final local gate counts, exact full-format last line and required current-head CI are recorded in PR/issue before completion.
- No human release inspection or registry publication is claimed.

## 6. Sad paths proved

| Trigger                                           | Expected disposition                                                  | Proof                                    |
| ------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------- |
| Empty/duplicate/unsupported environment selection | Reject with explicit validation feedback                              | Project contracts + real GUI             |
| Missing sign-in credentials                       | Every environment blocked; no invented authenticated capture          | Actual Next.js matrix                    |
| Separate browser launch failure                   | Aggregate blocked, independent successful Chromium evidence retained  | Browser-boundary failure + real Chromium |
| Changed dark-only styling                         | Dark baselines differ; light cells remain unchanged                   | 12-cell real reference-app comparison    |
| WebKit color metadata                             | Normalize only valid fixed markers; reject malformed/private metadata | Real WebKit + strict PNG contracts       |
| Matrix exceeds capture budget                     | Equal per-environment page bound; omissions stay explicit             | Shared policy contract                   |

Deferrals: DPR/zoom/locale/direction/forced-color/OS/real-device and arbitrary
interaction-state matrices, full heuristic coverage, independent human usability
and release inspection. WebKit engine evidence does not certify real-device Safari.
No existing retained-PNG assertion was weakened. Globals remain staged for integration.
