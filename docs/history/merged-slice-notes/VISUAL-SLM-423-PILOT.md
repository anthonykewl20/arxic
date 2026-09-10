# VISUAL-SLM-423-PILOT — staged doc updates (charter §10.2)

Issue: #423 · PR: (opened by this slice's push; #424 already merged separately) · Disposition: mixed

Continuation of VISUAL-SLM-423 (merged as `37aca7ed`) under the owner's
2026-09-08 "do all and fix all gaps and blockers" directive. Delivers the
pilot-family expansion: six controlled defect heads, nine real application
families, 178-row corpus, occlusion qualified on untouched test families.

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #423 | [VISUAL-SLM-423-PILOT] six-head pilot corpus across nine real families | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-08 | **#423 (VISUAL-SLM-423-PILOT) six-head pilot corpus DONE.** Six controlled heads (clipping/occlusion/missing_element/overflow/text_truncation/layout_shift) with measured-decision oracles; 178 rows across nine real families (repo fixtures, workbench, koel+directus docker, todomvc/sb-admin/adminlte pinned public clones) at 800+1280, frozen seed-423 splits; real Chromium end-to-end; occlusion 4/4 recall 0 FP on untouched test families (todomvc+koel), parity 2.3e-7; clipping/text_truncation/layout_shift honestly disabled (hard negatives, no qualifying threshold on 178 rows). Human inspection package staged (LLM assigns observed only). **M6 13/13 + 35/35 local.** Next: owner inspection + pilot-scale data. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- VISUAL-SLM-423-PILOT six-head pilot corpus (#423): occlusion/missing_element/text_truncation/layout_shift join clipping/overflow as controlled-variant heads with measured-decision oracles (hit-test, presence, DOM-Range text width, box movement); five new real application families boot-verified (mailpit docker excluded with a recorded pointer-interception finding; todomvc/sb-admin/adminlte pinned public clones served read-only); 178-row corpus with per-head evidence contracts and honest disabled heads. Occlusion qualified 4/4 recall / 0 FP on untouched test families; Python/native parity 2.3e-7.
```

## 4. `VERSION` bump required?

no — analysis-plane evidence and corpus tooling only; no user-observable product behavior changed (the compact model stays hypothesis-only shadow reports).

## 5. Evidence pointers

- Real-world proof: `apps/web/src/compact-visual/corpus-real-world.test.ts` (18/18, zero skips — real Chromium against both repo fixture apps, every head's oracle verified) and the local-only capture `docs/evidence/VISUAL-SLM/corpus-sixhead/capture-driver.mts` (nine families × 14 variants × 2 viewports, real Chromium + docker).
- Artifacts: `docs/evidence/VISUAL-SLM/corpus-sixhead/` (summary, corpus-report with Wilson intervals, manifest, console, per-head screenshots, driver) and `docs/evidence/VISUAL-SLM/human-review/` (owner inspection package, 7 before/current pairs).
- Gates: typecheck ☑ · lint (eslint via repo gate; not separately run this slice — noted) · format ☑ (`All matched files use Prettier code style!`) · test (13/13 affected + 35/35 compact-visual local) · license gate ☑ (no new deps; public clones are local-only) · CI on PR head: see PR checks (this note's push).

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                     | Expected disposition                                                    | Test                                                               |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Oracle contradicts controlled intent (mutation didn't take) | case skipped, reason recorded (47 skips all classified)                 | corpus-capture skip paths; corpus-real-world zero-skip assertion   |
| Removed-control cases with changing privacy-mask geometry   | skipped `unstable-case` (evidence contract `incompatible-masks` upheld) | mask-equality check on the removal path; train-time loadVisualCase |
| Family boot failure mid-corpus                              | loud `family-boot-failed` skip, capture continues                       | resilience path (koel transient timeouts recorded)                 |
| Text element too short to truncate honestly                 | `no-text-element` skip (koel, sb-admin)                                 | applyVariant returns skip reason                                   |
| Wide dashboards scrolling at 800px                          | per-family design-viewport override (adminlte/gentelella 1280)          | corpus-families.test.ts                                            |
| Head cannot meet precision/recall gates                     | threshold null = visibly disabled, never miscalibrated                  | corpus-real-world.test.ts thresholds assertion (heads 0/4/5 null)  |
| Mailpit control pointer-intercepted by its own UI           | family excluded with recorded finding, never mislabeled                 | corpus-sixhead summary                                             |

## Honest limits (reported, not hidden)

- 178 adjudicated rows vs the spec §9 pilot bar of 1,000 across ≥10 families; nine families contributed (two attempted families excluded with recorded reasons).
- Holdout is same-window (captured 2026-09-08); a chronological holdout still needs a later capture date.
- Clipping regressed from the two-head corpus on this data (hard-negative confusion); attribution recorded, gates untouched.
- VPS/full-stack claims remain container-preliminary; infrastructure purchases stay prohibited by the founding directive.
- Human inspection package staged; truth states stay observed until the owner inspects.
