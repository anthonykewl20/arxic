# VISUAL-SLM corpus two-head — hit/overflow evidence and the first second-head result (refs #423)

Date: 2026-09-06/07. Worktree `spike/visual-slm-423` @ `a28b226`. Predecessor: [corpus v2](../corpus-v2/summary.md).

## What changed

`measure()` now records **real hit-test fractions** (deterministic 5×5 `elementFromPoint` grid over the required control — spec §8.1 features 10–11) and **document-scrollport overflow** (features 12–13) instead of nulls. The variant registry carries **per-head labels**: a new layout-neutral `overflow-x` regression (transparent 1px absolutely-positioned element doubling the scrollport width, control untouched) and the established clip/negative set. Scenes gained a second deterministic hard check (`scrollport-overflow`); dataset rows label both heads from independent oracles, with the label-evidence guard extended to both.

**Browser finding (probed live):** Chromium includes transformed boxes in scrollable overflow — a `translateX(3000px)` control takes an 800 px viewport to 3481 px scrollWidth, which would make every clipping regression also overflow and leave the two heads inseparable. Clip mutations therefore clamp the scrollport (`overflow: clip`) after the transform (scrollWidth back to 800, control still unreachable): the clipping criterion isolates *reachability*, the overflow variant isolates *scrollport overflow*. Both defect classes remain genuine and independently measured.

## Corpus and results

195 admitted cases (10 variants × 4 viewports × 5 families), **5 honest skips**: one recurring arxic `content-change` instability and **all four directus `overflow-x` cases — `overflow-oracle-failed`**: directus's SPA shell never measures the injected width as document scrollport overflow, and the oracle refused to admit mislabeled cases rather than force them (recorded as an overflow-positive coverage gap for directus; the head still trained from the other families). Allocation unchanged and frozen before training: train = express, directus, arxic · calibration = next · **test = koel, untouched**. Parity 1.54e-7.

| Head (MLP, unchanged recipe + tightened calibration) | Threshold | koel holdout |
| --- | --- | --- |
| clipping | 0.8622 | **recall 16/20 (0.8), precision 1.0, 0 FP** — *worse than the 20/20 of the clip-only feature set*; the enriched lanes shifted the fit and left 4 positives unresolved. No threshold was loosened to recover them; attribution to the new feature lanes is future `ablate.py` work. |
| **overflow (first second-head result)** | 0.9817 | **recall 4/4, precision 1.0, 0 FP across 36 negatives** (including all clip regressions). Wilson bounds are wide with 4 positives (recall95 lb 0.510, FPR95 ub 0.096) — point gates pass, uncertainty gates honestly do not. |

The overflow head is the first learned signal on a second defect class, trained on real cross-family evidence and calibrated on a family it never saw in training. As always for this corpus: the deterministic scrollport predicate also catches all four (the measurement *is* the signal), so incremental value over the deterministic checks remains undemonstrated — the learned path's promise is heads and scenarios where deterministic predicates cannot be expressed, which is exactly what the remaining three heads require richer scene evidence for.

## Ablation attributes the clipping regression

`ablate.py` gained a `clip-era` variant (the pre-v2 feature set: box + clip lanes + image lane, hit/overflow lanes masked with value 0 and validity 0 — the documented missingness encoding). On the **same two-head corpus** the clip-era set scores **clipping 19/20 recall (0.95), 0 FP at threshold 0.6153** — recovering most of what the full lanes cost — while the overflow head collapses to 0/4 without its lanes (sanity: the head genuinely uses them). Retained: [clip-era-ablation-training-report.json](./clip-era-ablation-training-report.json).

**Interpretation (hypothesis, not a decision):** at this data scale one shared 96-feature vector serves both heads worse than per-head feature subsets would; per-head masking is exactly what the ablation tool now supports, and a per-head-feature experiment is justified only with more families/data. The shipped configuration keeps the full feature set (no gate weakened); the trade-off is disclosed rather than tuned away.

## Reproduce

```bash
pnpm --filter @arxic/web exec tsx src/compact-visual/cli.ts corpus NEW_DIR next,express,arxic,koel,directus 360,640,1024,1280
```

Retained: corpus manifest + full report + dataset provenance + training report, and the complete visual record for the koel/next overflow-x pairs, a koel clip pair and a directus clean pair (masked PNGs + privacy records + numeric scenes + sanitized timelines). No raw traces; no human pixel inspection claimed; promotion stays blocked (experimental model, uncertainty gates, incremental value, Pilot-scale corpus all open).
