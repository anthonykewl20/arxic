# CORPUS-SCALE-557-S2 — staged doc updates (charter §10.2)

Issue: #557 · PR: _this PR_ · Disposition: observed (slice 2 — full-registry corpus captured; the ≥1,000-row bar stays open with the precise residual recorded)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #557 | [CORPUS-SCALE-557] corpus scale: 10 families toward the 1,000-region bar | ◐ in progress |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-10 | **#557 (CORPUS-SCALE-557-S2) slice 2: full-registry corpus — 476 planned → 75 reason-carrying skips → 401 scored rows across all 10 families (was 178/9), 1,778 non-null oracle labels.** Real Chromium through `cli.ts corpus` over next/express/arxic/koel/directus + the five static families at 360/640/1024/1280 × 14 variants; `noTeacherCalls: true`, promotion untouched (`blocked-experimental-model`). C3 updated with both unit accountings and the honest residual (≥599 rows; needs registry growth, not padding). Evidence `docs/evidence/VISUAL-SLM/corpus-scale-2026-09-10/` (sanitized, zero leak hits, 63 sidecars parse). Dispositions: observed. **M0 gates green.** Next: #557 disposition — owner call on the region-label unit, or a registry-growth slice. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### changed`

```
- CORPUS-SCALE-557-S2 full-registry corpus (refs #557): the ten-family capture ran
  at the complete grid (360/640/1024/1280 × 14 variants; gentelella/adminlte pinned
  to 1280) — 476 planned, 75 skips each carrying its oracle reason, 401 scored rows
  across all ten families (up from 178 across nine) carrying 1,778 non-null oracle
  labels; deterministic-predicate adjudication (`noTeacherCalls: true`) and the
  promotion block are unchanged. Register C3 records both unit accountings and the
  residual; evidence retained sanitized under `docs/evidence/VISUAL-SLM/corpus-scale-2026-09-10/`.
```

## 4. `VERSION` bump required?

no — corpus/evidence bookkeeping, not user-observable product behavior.

## 5. Evidence pointers

- Real-world proof: `cli.ts corpus <dir> next,express,arxic,koel,directus,todomvc,gentelella,sb-admin,adminlte,sb-admin-2 360,640,1024,1280` (run dir local-only, `/tmp/corpus-scale-s2-G55F`) — exit 0, summary JSON: rows 401, families 10, skipped 75, parityMaximumError 6.4e-7, promotion blocked-experimental-model.
- Retained sanitized: `docs/evidence/VISUAL-SLM/corpus-scale-2026-09-10/` — corpus-v2.json + corpus-report.json + 20 representative cases (10 families × up to 3 variants, before/current PNGs with privacy sidecars, sanitized timelines); 63 sidecars parse; zero leak-pattern hits.
- Register: `docs/release-gates/undischarged-gates.md` C3 rewritten with the observed numbers, both unit readings, and the honest residual.
- Gates: typecheck ☑ · lint ☑ · format ☑ (full repo, after this note) · test (docs/evidence-only diff; corpus-families suite green at slice 1; full suite green on base 911aa9ca lineage) ☑ · license gate ☑

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                       | Expected disposition                                                  | Test                                                             |
| --------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Family boot or control seam fails mid-capture | loud per-family skip with reason, remaining families still contribute | `captureCorpusV2` family loop (75 skips recorded, run completed) |
| Unstable case at a width/variant              | oracle-honest skip, not a fabricated row                              | `unstable-case` ×46 in corpus-v2.json                            |
| Bar unmet under the register's unit           | reported, not padded; residual stated precisely                       | register C3 lines + evidence summary                             |
