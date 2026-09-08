# VISUAL-SLM corpus v2 — five-family cross-application corpus (refs #423)

Date: 2026-09-06/07. Worktree `spike/visual-slm-423`. Predecessor: the three-app smoke corpus whose learned model missed 0/4 held-out Arxic clips ([failure analysis](../failure-analysis/summary.md)).

## What was captured

Real Chromium captures against **five independent application families**: the repo's Next.js reference app, Express vulnerable app, the actual Arxic workbench login, and the permitted local third-party apps **koel** (Laravel/Vue, pinned clone, helper container) and **directus** (Vue admin, same). Four viewports (360/640/1024/1280 × 800) × nine controlled variants per family:

- five regressions — `clip-full`, `clip-right-75/50/25` (graded: exactly 75/50/25 % of the required control retained; measured clips landed exactly on the keep fractions), `clip-bottom-50`;
- four negatives — `clean`, `content-change` (a non-control text element changes; the required control's identity survives), `overlay-adjacent` (legitimate banner, does not cover the control), `style-tweak` (global brightness).

**179 cases admitted, 1 honest skip** (arxic `overlay-adjacent` at one viewport, `unstable-case` — mask/geometry moved between captures; recorded in the manifest, never silently dropped). Labels come from the independent measured clip fraction (`evaluateOracle`), never from mutation intent; graded clips must land within the documented 0.12 tolerance. koel's submit control binds by css (`form button[type="submit"]`) because its accessible name is empty live-confirmed (#383); directus binds by role.

**Allocation frozen before training** (seed 423, sha256-stable family order, groups never split): train = express, directus, arxic · calibration = next · **test = koel (untouched holdout)**. [`corpus-v2.json`](./corpus-v2.json) binds the frozen allocation hash; every case file is hash-checked at load.

## Results (MLP, unchanged recipe: seed 423, 30 epochs, float64→float32)

| Stage | Threshold policy | koel holdout (20 positives / 16 negatives) |
| --- | --- | --- |
| lowest qualifying threshold (prior policy) | 0.0831 | recall **20/20**, precision 83.3 % — **4 FP** (all four negative variants at 360 px, scores 0.0897 vs 0.0831: the threshold sat at the calibration family's negative band edge) |
| highest qualifying threshold ([tightened policy](../../../scripts/visual-slm/train.py) `calibrate_thresholds`) | 0.5064 | recall **20/20**, precision **100 %**, 0 FP |

The policy change keeps both calibration gates (precision ≥ 95 %, recall ≥ 90 % on the calibration family) and selects the **highest** qualifying candidate instead of the lowest — a tightening that maximizes the margin against cross-family score drift. Red-first worked example pins the selector (`test_train.py`).

Native/Python parity over all 179 rows: max error **1.65e-7** (≤ 1e-5 gate). Dataset regeneration is byte-identical to the capture-time extraction (deterministic features); training is fully seeded.

## Honest gate status — promotion stays blocked

- **Point quality passes** (precision 100 %, recall 100 %, FPR 0 on the holdout family).
- **Uncertainty gate fails on sample size**: Wilson 95 % precision lower bound 0.839 < 0.90 required; recall lower bound 0.839 (≥ 0.80 required — passes); FPR upper bound 0.194 > 0.10. One test family with 36 cases cannot clear the spec §12 intervals. The spec's stage table is explicit: 5 families / 179 regions is between Smoke and Pilot (Pilot = 10 families, 1 000 adjudicated regions).
- **Incremental value remains undemonstrated** for this criterion: the deterministic viewport oracle also scores 20/20 with 0 FP on the same holdout — expected, since the clip measurement is the deterministic signal itself (WS1's counter-result). Learned value must be earned on harder evidence (other heads, automatic candidates), not by threshold arithmetic.
- Deterministic hard failures are preserved in every shadow review; reports never claim overall pass; heads beyond clipping remain unsupported.

## Reproduce

```bash
# capture + train the full corpus (fixtures boot via the repo testkit; koel and
# directus need the thirdparty-dg helper images per their BOOT-PROCEDURES.md):
pnpm --filter @arxic/web exec tsx src/compact-visual/cli.ts corpus /tmp/arxic-423-corpus next,express,arxic,koel,directus 360,640,1024,1280
# reduced fixture-only variant (what CI exercises):
pnpm --filter @arxic/web exec tsx src/compact-visual/cli.ts corpus /tmp/arxic-423-corpus next,express 800
```

Retained here: corpus manifest + full corpus report + dataset provenance + training report (all scores/thresholds/metrics), and the complete koel 360 px visual record (all nine variants) plus representative pairs for every other family and koel mid-size clips — masked PNGs with adjacent privacy records, numeric scenes, sanitized timelines and provenance. No raw trace ZIPs; no human pixel inspection is claimed.

## What this does NOT establish

Not a Pilot-stage dataset (10 families / 1 000 regions); no naturally occurring defect prevalence (all regressions are controlled); one criterion head only; the holdout is one family, so cross-family uncertainty is understated; no promotion, no deployment claim, no resource qualification. Next corpus step per spec §9: more independent families and a chronological holdout.
