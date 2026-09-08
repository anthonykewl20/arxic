# VISUAL-SLM failure analysis — held-out clipping miss (refs #423)

Date: 2026-09-06. Code: worktree `spike/visual-slm-423`. Question: why did the calibrated MLP detect **0/4** held-out Arxic clipping positives while the deterministic viewport check caught all four?

All numbers below come from this session's fresh reproduction and four feature-lane ablations, retained beside this file in [`analysis.json`](./analysis.json) and [`training-reports/`](./training-reports/). Machine-readable provenance: dataset sha256 `259ca3df72ca375fd54a0dd584b67edff74a587c3794277812639f21dedf4fde` — **byte-identical** to the retained foundation corpus; every score, threshold and the native parity error (1.7532656138019576e-7) reproduce exactly. The failure is deterministic, not flaky.

## Reproduction (E1)

`cli.ts demo` on a fresh output directory (Next=train, Express=calibration, Arxic=test; seed 423): MLP threshold **0.8921**, Arxic clipped scores 0.1662–0.2942 → 4 unresolved positives, 0 false alerts on 4 negatives. Identical to the retained evidence.

## Ablations (via `scripts/visual-slm/ablate.py`, recipe/thresholds unchanged)

| Variant | Kept features | MLP threshold | Arxic test | Per-app clipping-score bands (clipped / clean) |
| --- | --- | --- | --- | --- |
| full (E1) | all 96 | 0.8921 | **0/4, 0 FP** | Arxic 0.17–0.29 / 0.13–0.23 · Next 0.32–0.45 / 0.30–0.41 · Express 0.89–0.92 / 0.86–0.88 |
| geometry (E2a) | 0–31 | 0.8835 | 0/4, 0 FP | same cross-app shift persists without image features |
| image (E2b) | 32–95 | none (uncalibratable) | abstain | ~0.49–0.52 everywhere: **no signal in the image lane alone** |
| clip-only (E4) | {9, 25} | 0.5870 | **4/4, 0 FP** | identical bands across all apps (clipped 0.587 / clean 0.342) |
| current-geometry (E5) | 4–15 + validity 20–31 | 0.8414 | 0/4, 0 FP | large within-app margins (Arxic 0.54–0.70 / 0.25–0.37) but band still below the Express-calibrated threshold |

The logistic baseline never produced a qualifying threshold in any variant; on clip-only input it even scored clean **above** clipped (0.5456 vs 0.4644) — it failed to learn the feature sign within 30 epochs.

## Diagnosis

1. **Not an implementation defect.** Extraction, label semantics, app grouping, native parity: all consistent; exact reproduction.
2. **Data coverage (primary cause).** One training application (8 rows) for 8,486 parameters; feature normalization fitted on that application alone; calibration on a second single application. Score offsets between applications (~0.3–0.7) dwarf within-app clipped-vs-clean margins.
3. **Representation (contributing).** The geometry lane mixes the transferable oracle (current clip fraction) with per-application fingerprints (box position/size distributions). The image lane alone carries no signal for this defect family.
4. **Calibration (proximate cause).** A single-app absolute threshold cannot transfer across the per-app score offsets — E5 proves the model can rank correctly within every app and still miss everything through one Express-calibrated cutoff.
5. **Optimization (secondary).** The linear baseline under-fits at this data scale (wrong sign after 30 epochs).

**Confirmed counter-result:** the current-clip feature alone transfers perfectly **because it is identical across applications — it *is* the deterministic measurement**. For the required-submit-inside-viewport criterion the deterministic check is strictly preferable, and no threshold was loosened to disguise that. Learned incremental value must be demonstrated on harder evidence (partial clipping, the other five heads, automatically discovered candidates), never by weakening this baseline.

## Smallest justified next experiment

Cross-app calibration is untestable with three single-app groups; it needs **≥5 application families (3 train / 1 calibration / 1 test)** at minimum, and the spec's pilot target (10 families, 1,000 adjudicated regions) stands. That is Workstream 2's corpus. Trainer-side candidates (normalization robustness, epoch budget for the linear baseline) are recorded as WS3 experiments and stay unimplemented until the corpus can evaluate them honestly.

## Reproduce

```bash
pnpm --filter @arxic/web exec tsx src/compact-visual/cli.ts demo /tmp/arxic-423-fa           # E1
for v in geometry image clip-only current-geometry; do
  mkdir -p /tmp/arxic-423-fa-$v
  python3 scripts/visual-slm/ablate.py /tmp/arxic-423-fa/dataset.json "$v" /tmp/arxic-423-fa-$v/dataset.json
  python3 scripts/visual-slm/train.py /tmp/arxic-423-fa-$v/dataset.json /tmp/arxic-423-fa-$v/training --epochs 30
done
```

The original three-application Arxic holdout has now been inspected and tuned against — per the issue backlog it is **development data**; any future generalization claim requires a fresh untouched holdout.
