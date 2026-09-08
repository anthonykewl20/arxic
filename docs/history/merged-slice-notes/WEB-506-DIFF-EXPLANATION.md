# WEB-506-DIFF-EXPLANATION — staged doc updates (charter §10.2)

Issue: #506 · PR: (filled at PR creation) · Disposition: verified (deterministic fusion unit tests + two real Chromium journeys; boundaries below)

## 1. `docs/SYNC.md` — tracker row (no numbered tracker table applies; #506 rides #402's scope. Suggested RESUME-note sentence)

```
Explainable diffs landed (#506): every changed region carries a deterministic, hash-bound explanation fusing measured scene elements and failing checks; unexplained paint stays labeled and preserved.
```

## 2. `docs/SYNC.md` — session-log row (append)

```
| 2026-09-09 (6) | **#506 (WEB-506-DIFF-EXPLANATION) deterministic diff explanations DONE.** New pure service `diff-explanation.ts` fuses each pixel-diff region (DPR-aware CSS conversion, fail-closed on unsupported scales) with intersecting measured scene nodes (innermost-first, kind label + coverage, deterministic order) and non-pass checks (fail before unverified; document-level checks listed separately); regions without a measured element stay `unexplained` — preserved, never attributed (visual-oracle "Pixels" rule). Attached at drain comparison time only from the current capture's SHA-256-verified assessment bytes (missing/unverifiable ⇒ honest absence); `Capture.diffExplanation` type; the diff viewer renders the per-region evidence list (`data-region-evidence`). 7/7 unit (incl. DPR fail-closed, truncation, missing-scene honesty) + real vulnerable-auth-app journeys: the real regression run in `visual.test.ts` carries a hash-bound explanation containing the real `document-horizontal-overflow` fail, and a real-browser dashboard journey renders `Heading N%` evidence. Next: AI-hypothesis layer joined onto explanations; per-element source mapping; evidence export. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- WEB-506-DIFF-EXPLANATION deterministic diff explanations (#506): every changed capture now carries `diffExplanation` — each pixel-diff region converted to CSS pixels by its device scale factor and fused with the measured scene elements that intersect it (innermost first, element kind and coverage share) plus failing/unverified checks overlapping it and document-level non-pass checks, computed only from the current capture's hash-verified assessment bytes; regions with no measured element are preserved and labeled `unexplained` rather than attributed, and missing assessment evidence yields no explanation instead of a guess. The diff viewer renders the per-region evidence beside the region overlays; no model participates.
```

## 4. VERSION bump required?

yes → 0.0.303 (user-observable: new `diffExplanation` capture data + the diff-viewer evidence list), folded by the integrator with this note.

## 5. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/visual.test.ts` (real vulnerable-auth-app + real Chromium; the real regression run's explanation is hash-bound and includes the real `document-horizontal-overflow` document check) and `apps/web/src/__tests__/diff-evidence-ui.real-world.test.ts` (real dashboard in a real browser renders the per-region evidence list naming the changed `Heading`).
- Unit proof: `apps/web/src/__tests__/diff-explanation.test.ts` — 7/7.
- Gates: typecheck + typecheck:packages ☐ · lint ☐ · format:check ☐ (last line pasted in the PR) · CI `ci` check ☐

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                         | Expected disposition                                   | Test                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| deviceScaleFactor outside {1,2,3}               | fail-closed: region unexplained, never mis-scaled      | diff-explanation.test.ts                                                                                 |
| Region outside scene bounds / zero-area         | unexplained, never attributed                          | diff-explanation.test.ts                                                                                 |
| Truncated scene                                 | `sceneTruncated` flag; explanation still deterministic | diff-explanation.test.ts                                                                                 |
| Missing scene/assessment                        | every region unexplained, `sceneMissing`, no crash     | diff-explanation.test.ts                                                                                 |
| Assessment bytes fail the SHA-256 gate at drain | no `diffExplanation` on the capture (honest absence)   | explainFromAssessment guard (unit-covered indirectly; drain uses the same digest gate as artifact reads) |
| Passing checks near a region                    | never listed (non-pass only)                           | diff-explanation.test.ts                                                                                 |
| Region with no intersecting node                | `unexplained: true`, preserved                         | diff-explanation.test.ts                                                                                 |
