# WEB-402-ORACLE — staged doc updates (charter §10.2)

Issue: #402 · Disposition: observed; full-product work remains open.

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

Add under current #402 progress: numeric layout assessment artifacts and the
full visual-oracle contract are implemented in this slice. Expanded
contrast/alignment/occlusion, state/matrix and scene-bound AI fusion remain open.
Do not flip the full #402 tracker to complete.

## 2. `docs/SYNC.md` — session-log row (append to the table)

2026-09-06 — WEB-402-ORACLE adds bounded numeric layout observations, screenshot
hash-linked assessments, deterministic overflow classification and explicit
unverified coverage. Real Chromium/Express proof includes two clean captures,
controlled overflow and artifact tampering. See evidence summary and current PR
checks. Full visual auditor remains in progress under #402.

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

- Visual captures retain numeric layout assessment artifacts with screenshot
  binding, stability checks, deterministic document-overflow measurements,
  tamper rejection and explicit unverified families. The full visual-auditor
  contract documents requested coverage, applicability and remaining work
  (WEB-402-ORACLE, refs #402).

## 4. `VERSION` bump required?

Yes, user-visible assessment artifacts. Integrator applies the next available
owner-defined minor increment; this worktree does not alter VERSION or manifests.

## 5. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/visual.test.ts`.
- Assessment seam: `apps/web/src/__tests__/visual-oracle.test.ts`.
- Artifacts: `docs/evidence/WEB-402-ORACLE/summary.md`.
- Initial checks: five tests pass, typecheck/lint exit 0, license `Rejected: 0`.
- Full-repo format and current-head CI results belong in the PR report.
- Full project completion, human inspection and release are not claimed.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                             | Expected disposition                           | Test                          |
| --------------------------------------------------- | ---------------------------------------------- | ----------------------------- |
| Capture consent missing / required mask absent      | blocked                                        | Real visual-run test          |
| Stable screenshot or finite numeric evidence absent | observed with unverified assessment            | Assessment seam tests         |
| Real document overflow                              | observed measurement, failing scoped predicate | Real visual-run test          |
| Assessment bytes tampered                           | fail-closed retrieval rejection                | Real visual-run test          |
| Other visual families unimplemented                 | observed with explicit unverified coverage     | Assessment and real-run tests |
