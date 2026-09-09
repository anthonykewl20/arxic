# WEB-402-FINDING-DETERMINATION — staged doc updates (charter §10.2)

Issue: #402 · PR: #<PR> · Disposition: observed (determinations are recorded facts from retained evidence; nothing assigns `verified`)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
(No milestone row — #402 slice; record under the #402 status paragraph.)
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-09 | **#402 (WEB-402-FINDING-DETERMINATION) deterministic per-finding determination DONE.** AI visual findings move beyond bare hypotheses without SLOP: the capture's assessment now retains `scene.maskedRects` (the automatic+required mask selectors' element rects — numeric geometry, capped, hash-covered by the existing assessmentSha256), and `determineFinding(region, maskedRects, checks)` (pure, verdict-filtering defensively — a passing check list can never confirm anything) determinates every finding server-side from sha-verified retained evidence: `refuted/masked-region` (≥60% of the finding area on mask pixels — the model's prompt forbids diagnosing masks; the lane CATCHES violations from geometry), `confirmed/deterministic-check` (≥25% overlap with a FAILED retained check — layout overflow/contrast corroboration with check ids), `unconfirmed` (explicit, never silently promoted) and `unavailable` (assessment missing or sha-mismatched — fail-closed). The determination field sits OUTSIDE the model's closed schema (model-authored determinations remain impossible), and the panel renders the per-finding determination chip. Proven red-first: the full truth-table units; the REAL vulnerable app harness — a provider finding placed on a REAL masked input's retained rect is refuted, a clean-pixel finding is unconfirmed, secrets never serialize; the finding-evidence UI journey extended with the chip assertion; visual-review regressions 9/9. Remaining #402: paid inference proof, the human release inspection. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### <added|changed|fixed|security|internal>`

```
### Added

- WEB-402-FINDING-DETERMINATION deterministic finding determination (#402): visual captures retain the privacy-mask element geometry inside the hash-covered assessment, and every AI visual-review finding is deterministically determined server-side from that retained evidence — findings placed on masked pixels are refuted by geometry, findings overlapping a failed deterministic check (layout overflow, text contrast) are confirmed with the corroborating check ids, everything else is explicitly unconfirmed, and missing or mismatched evidence is fail-closed. Determinations cannot be authored by the model (outside the closed output schema) and never upgrade a finding's truth state beyond the recorded facts.
```

## 4. `VERSION` bump required?

no (integrator folds; user-observable capability — candidate bump at fold time, integrator's call)

## 5. Evidence pointers

- Truth-table units: `apps/web/src/__tests__/finding-determination.test.ts` — refuted (≥60% mask coverage, coverage relative to the finding area), partial-coverage non-refutation, confirmed (failed-check overlap ≥25%, ids sorted), passing/outside checks never confirm, fail-closed unavailability, refutation precedence.
- Real-harness proof: `apps/web/src/__tests__/finding-determination.real-world.test.ts` — the REAL vulnerable app, real capture: `scene.maskedRects` populated from the real page; a provider finding on a REAL masked input's rect → `refuted/masked-region`; a clean-pixel finding → `unconfirmed`; determinations stamped server-side from sha-verified assessment bytes; secret canaries absent.
- UI proof: `apps/web/src/__tests__/finding-evidence-ui.real-world.test.ts` (extended) — the determination chip renders on the real page; older findings without determinations render the guarded fallback.
- Artifacts: `docs/evidence/WEB-402-FINDING-DETERMINATION/{red,green}.txt`.
- Gates: typecheck ☑ (root + packages + web) · lint ☑ · format ☑ full repo · test ☑ (18/18 across the five lanes) · license gate — CI `package` job.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                   | Expected disposition                                                       | Test                              |
| ----------------------------------------- | -------------------------------------------------------------------------- | --------------------------------- |
| finding region ≥60% on masked pixels      | `refuted/masked-region` — deterministic contradiction of the model's claim | real-harness + units              |
| assessment file missing or sha-mismatched | `unavailable/assessment-evidence-missing` — fail-closed, no guess          | units + wiring guard              |
| passing checks overlapping the region     | never confirms (verdict-filtered inside the service)                       | units                             |
| clean region, all checks passing          | `unconfirmed/no-deterministic-corroboration` — explicit, never silent      | real-harness + UI                 |
| model attempts to author a determination  | impossible — the field is outside the closed schema (stamped server-side)  | schema (pre-existing) + wiring    |
| fractional/rounding at the DOM boundary   | integer regions validated by the review schema (pre-existing)              | real-harness (rounding disclosed) |
