# CORPUS-EVALUATE-553 — staged doc updates (charter §10.2)

Issue: #553 · PR: #<TBD> · Disposition: verified (mode + sad path machine-proven; the chronological holdout capture it unlocks remains to be run and the C4 register entry stays open until then; human gates untouched)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #553 | [CORPUS-EVALUATE-553] evaluate-only corpus mode (no retrain) | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-10 | **#553 (CORPUS-EVALUATE-553) evaluate-only corpus mode DONE.** `cli.ts corpus-evaluate` captures a genuinely fresh corpus via `captureCorpusV2` and scores every adjudicated row against the ALREADY trained artifact through the existing native kernel — the Python trainer, rust compile, dataset/provenance rewrites, model manifests and promotion pointer are never invoked, proven by sha256-identical `dataset.json` + all `training/` artifacts across the round trip. Report binds scores to the trained bins (logistic/mlp sha256, dataset hash) and writes per-head confusion counts + accuracy for all six heads with a `scoreable` flag: heads without trained thresholds are reported unscored, never fabricated. Labeling is shared, not duplicated: the row-building loop moved out of `trainCorpusV2` into exported `buildLabeledRows` (real capture + real CPU training proved by `corpus-real-world.test.ts` still passing, 14.9s, and the new round-trip test, 9.6s). Sad path: evaluate into a directory with no trained artifact refuses `no-trained-artifact` before any capture or write. Disposition: mode verified against the real next+express corpus and real trainer; the C4 chronological holdout (genuinely later capture across third-party roots, scored against the active trained artifact) is unblocked but not yet run. **M< x> <n>/<total>.** Next: run the chronological holdout capture and update register C4. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- CORPUS-EVALUATE-553 evaluate-only corpus mode (#553): `cli.ts corpus-evaluate` (and the `evaluateCorpusV2` service) captures a fresh corpus and scores it against the already-trained compact-visual artifact through the existing native kernel without invoking the trainer, the rust compile, or any dataset/model/promotion write — sha256-proven byte-identical training artifacts — binding every score to the trained bins and reporting per-head confusion metrics with unscored heads marked `scoreable: false` instead of fabricated; labeling is shared with training via the extracted `buildLabeledRows` service.
```

## 4. `VERSION` bump required?

no — no product/runtime behavior changes for existing users; the new command is additive tooling and no release is authorized.

## 5. Evidence pointers

- Real-world proof: `apps/web/src/compact-visual/corpus-evaluate.real-world.test.ts` — real Chromium captures of the next+express fixture families at viewport 800 (3 controlled variants), real Python CPU trainer + rust native kernel (rustc 1.98.1) via `trainCorpusV2`, then evaluate-only scoring; round trip 9.6s; regression `corpus-real-world.test.ts` 14.9s passing.
- Artifacts: `/tmp` mkdtemp state dirs (ephemeral, removed); `corpus-evaluation.json` written per run into the evaluated state dir.
- Gates: typecheck (apps/web tsc exit 0) ☑ · lint ☐ (CI static) · format ☐ (full-repo check before PR) · test (2 new + 1 regression passing locally) ☑ · license gate ☐ (CI)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                                     | Expected disposition                                                                 | Test                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Evaluate into a directory with no trained artifact (`training/*`, model manifests, `visual-native` missing) | refuse `no-trained-artifact (<file> missing)` before any capture or write            | `fails closed before capturing or writing when no trained artifact exists` — observed (hypothesized→observed; machine-verified in-suite) |
| Artifact lacks thresholds/supported for a head (no positive examples in training corpus)                    | head reported `scoreable: false` with `cases: 0` — never fabricated as a scored zero | round-trip test asserts the four untrained heads unscored and the two trained heads exercised                                            |
