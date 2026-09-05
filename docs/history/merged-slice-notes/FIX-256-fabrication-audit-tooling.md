# FIX-256-fabrication-audit-tooling — staged doc updates (charter §10.2)

Issue: #256 · PR: TBD (filled at PR open) · Disposition: verified

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #256 | [FIX-256-fabrication-audit-tooling] DG-12 exit-gate criterion-4 tooling: dg12-fabrication-audit.mjs + dg12-sweep.mjs | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-27 | **FIX-256-fabrication-audit-tooling (#256) tooling DONE.** Closed the criterion-4 tooling gap flagged in the #256 thread ("no dedicated fabrication-audit script exists in scripts/dg12-* — manual audit only"): `scripts/dg12-fabrication-audit.mjs` independently re-derives the stage-13 evidence index and checks every recorded ledger intent's `evidenceRefIds` resolve into it (LOCKSTEP with `sourceEvidenceId`, packages/intent/src/ledger.ts:210-216), plus flags any intent recorded on a non-`extracted` row. Fail-closed on missing/malformed artifacts, zero runs, dangling refs, or fabricated-row intents. Proved red-first against a REAL recorded koel campaign run (10 self-consistent rows extracted verbatim from an actual `arxic run`, test-fixtures/dg12-fabrication-audit/) plus mutated-copy and hand-edited sad paths (16/16 tests passing, scripts/dg12-gates.test.mjs). Added `scripts/dg12-sweep.mjs` composing the machine-scriptable subset (G-2/G-3/G-4/G-5/G-7 two-run-comparison half) into one per-gate pass/fail table; G-1 (live campaign), G-6 (citation + secret sweep, separate tool), G-7 `--rebuild` (needs a TS-aware runtime in this environment), and G-8 (ADR flip, strictly last) are explicitly NOT composed in — printed as "NOT COVERED" rather than forced. Zero model spend; did not touch docs/evidence/DG-12/**, packages/orchestrator-langgraph/**, packages/model-adapter/**, or packages/domain-inventory/**; did not run or claim the real exit-gate verdict; did not touch ADR-008. Next: #324 lands, then the #256 owner lane runs the real campaigns and this tooling against them. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- FIX-256-fabrication-audit-tooling (#256): add `scripts/dg12-fabrication-audit.mjs` (DG-12 exit-gate criterion 4 — zero fabricated intents, independently re-checked over recorded artifacts, fail-closed) and `scripts/dg12-sweep.mjs` (composes the machine-scriptable G-2/G-3/G-4/G-5/G-7 gates into one per-gate pass/fail report); `scripts/dg12-grounded-ratio.mjs` (G-3) now also reports the structural grounding CEILING (`extracted rows / denominator`) alongside the measured ratio, so a run where non-extracted rows cap the attainable percentage below 100% (the real #324 koel finding: 304/315 = 96.5%) is never misread as a defect; backed by 17 tests including real recorded-campaign fixtures under test-fixtures/dg12-fabrication-audit/.
```

## 4. `VERSION` bump required?

no — internal gate tooling for an as-yet-unrun milestone exit gate; not user-observable per RELEASES.md.

## 5. Evidence pointers

- Real-world proof: `scripts/dg12-gates.test.mjs` (`dg12-fabrication-audit` and `dg12-sweep` describe blocks) — real koel campaign artifacts (`test-fixtures/dg12-fabrication-audit/koel-run1-{artifacts-13,intents}.json`, extracted verbatim from an actual `arxic run` against the real koel target, self-consistent evidence subset) prove the PASS path; a mutated copy (dangling evidence ref) and a hand-edited non-extracted row (fabricated intent) prove the two FAIL paths independently.
- Artifacts: `scripts/dg12-fabrication-audit.mjs`, `scripts/dg12-sweep.mjs`, `scripts/dg12-lib.mjs` (`fabricationAuditForRun` + `sourceEvidenceId`/`sanitizeEvidencePath`), `scripts/dg12-gates.test.mjs`, `test-fixtures/dg12-fabrication-audit/*.json`.
- Gates: typecheck ☐ (not applicable — plain `.mjs`, no package touched) · lint ☑ (`pnpm exec eslint scripts/dg12-fabrication-audit.mjs scripts/dg12-sweep.mjs scripts/dg12-lib.mjs scripts/dg12-gates.test.mjs` — 0 findings) · format ☑ (see PR / report for `pnpm format:check` last line) · test ☑ (16/16 passing, `pnpm vitest run scripts/dg12-gates.test.mjs`) · license gate ☐ (no new dependency added).

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                            | Expected disposition                                                                                                 | Test                                                                                                               |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| No campaign runs recorded under `<app>/runs`                                                       | blocked — exit 1, "records no campaign runs"                                                                         | `dg12-fabrication-audit … fails closed when no campaign runs are recorded`                                         |
| A real recorded intent's `evidenceRefIds` mutated to a ref absent from the stage-13 evidence index | blocked — exit 1, "DANGLING EVIDENCE REFS" naming the offending ref                                                  | `dg12-fabrication-audit … fails closed when a real recorded intent is mutated to cite a non-existent evidence ref` |
| A non-`extracted` row hand-edited to carry an intent                                               | blocked — exit 1, "FABRICATED-ON-NON-EXTRACTED-ROW" naming the row                                                   | `dg12-fabrication-audit … fails closed when a non-extracted row is hand-edited to carry a fabricated intent`       |
| One gate in the sweep regresses (grounded ratio below threshold) while others still pass           | blocked — sweep exits 1 overall, per-gate table still shows the passing gates as PASS and the regressed gate as FAIL | `dg12-sweep … reports FAIL for the specific gate that regresses and still exits non-zero overall`                  |
| Denominator includes non-`extracted` rows, which can never be grounded (structural ceiling < 100%) | informational — printed alongside the pass/fail verdict, never itself a pass/fail condition                          | `dg12-grounded-ratio … reports a structural ceiling below 100% when non-extracted rows are present`                |
