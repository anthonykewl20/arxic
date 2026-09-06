# Compact visual reviewer — experimental foundation

Refs [#423](https://github.com/anthonykewl20/arxic/issues/423). Design and remaining acceptance gates: [full specification](../../docs/visual-small-model-spec.md).

This is a runnable **development experiment**, not a production visual oracle or qualified VPS service. Codex implements the foundation. No GLM call, paid model endpoint, GPU or downloaded model is used. The initial learned detector **failed** its Arxic holdout: all four clipped-button cases were unresolved at the calibrated threshold. The deterministic viewport check caught them. Do not replace existing checks or promote these weights.

## What runs

- Bounded local evidence validation, canonical PNG/hash checks, masks, scene/timeline references and split-group validation.
- Shared pixel comparison and exactly 96 image/geometry features for explicitly supplied regions.
- CPU-only logistic and 8,486-parameter MLP training, independent numerical-gradient checks, masked labels and calibration/test separation.
- Crate-free Rust inference with bounded binary input, shape/finite-value checks, immutable hash-checked model bytes and Python/native score parity.
- Shadow JSON reports that preserve hard checks even when model loading/inference fails, abstain on missing evidence/unsupported heads and cannot report overall pass.
- A real Chromium workflow capturing Next, Express and Arxic, and an evaluator retaining failures and support counts.

Implementation is in [apps/web/src/compact-visual](../../apps/web/src/compact-visual). Browser capture and provider transport are not reimplemented. The shared image comparison is [visual-pixels.ts](../../apps/web/src/visual-pixels.ts), also used by the existing web visual comparison. No dashboard model switch or automatic baseline/model promotion is added. Product-path services: `intake.ts` (bounded admission: one active + four queued, backpressure, per-job deadline, crash-recoverable JSONL journal with idempotent re-submission), `retention.ts` (spool byte cap, oldest-first eviction, pinned evidence protected, unreclaimable pins reported) and `activation.ts` (content-addressed model staging, hash + validation gate, atomic activation, known-good rollback) implement the spec §13/§14 operating bounds as tested service blocks; they are not yet wired into a deployed server.

## Reproduce from the repository root

Requirements: existing repository Node/pnpm dependencies and Chromium, Python 3.12+ (standard library only), and Rust 1.89.0. `ARXIC_VISUAL_PYTHON` and `ARXIC_VISUAL_RUSTC` can point to those executables. CI pins Rust 1.89.0 on GitHub-hosted runners. No Rust crates or Python pip dependencies are needed. The trainer uses float64 optimizer arithmetic and exports float32 weights; parity tolerance is unchanged at 1e-5.

```bash
pnpm install --frozen-lockfile
pnpm --filter @arxic/web exec playwright install chromium
python3 scripts/visual-slm/test_train.py
rustc --test scripts/visual-slm/native.rs -o /tmp/arxic-visual-native-tests
/tmp/arxic-visual-native-tests
pnpm exec vitest run apps/web/src/compact-visual
pnpm --filter @arxic/web exec tsx src/compact-visual/cli.ts demo /tmp/arxic-visual-demo
```

Use a **new output directory** for each run. Writes are exclusive and never overwrite prior evidence/models. Run capture serially in this project's isolated worktree; reference-app builds share directories inside a checkout. Ports and sqlite state are ephemeral. Leave shared Mailpit settings unset.

The demo captures 24 cases: four viewports × clean/clipped × three applications. It measures the visible required submit button, deliberately moves it outside the viewport in the regressed cases, captures masked images and records the independent geometry. These are controlled real-app regressions, not naturally occurring defect prevalence. Next is training, Express calibration, Arxic test; all viewports/mutations of an application remain in that application's group. This tiny 1/1/1 group allocation is a smoke-specific exception to the eventual 60/20/20 corpus plan, not a promotion dataset.

Generated files include `corpus.json`, PNGs and adjacent privacy records, numeric scenes, sanitized action timelines and provenance, `dataset.json`, dataset provenance, `training/{logistic,mlp}.bin`, training/evaluation report, hash-bound model manifests, a locally compiled `visual-native`, and `foundation-report.json`.

```bash
# Separate collection and training, using a fresh directory:
pnpm --filter @arxic/web exec tsx src/compact-visual/cli.ts capture /tmp/arxic-visual-new
pnpm --filter @arxic/web exec tsx src/compact-visual/cli.ts train /tmp/arxic-visual-new

# Inspect a retained case or run a shadow review:
pnpm --filter @arxic/web exec tsx src/compact-visual/cli.ts extract /tmp/arxic-visual-demo next-800-clipped.json
pnpm --filter @arxic/web exec tsx src/compact-visual/cli.ts review /tmp/arxic-visual-demo next-800-clipped.json mlp-model.json /tmp/arxic-visual-demo/visual-native
```

The `train` orchestration is deliberately scoped to the captured viewport-clipping corpus and checks labels against its geometry findings. The Python numerical trainer independently accepts a bounded JSON array of `{id, group, split, features, labels}` rows (96 features, six labels of 0/1/null), at most 10,000 rows/32 MiB. Direct numerical input is a developer interface, not evidence admission or promotion authority. Unknown labels contribute no loss. Use `python3 scripts/visual-slm/train.py DATASET NEW_OUTPUT --epochs 30`; fewer epochs are for plumbing tests, never a silent benchmark change. Positive thresholds come from `calibrate_thresholds`: among candidates meeting precision ≥95% and recall ≥90% on calibration rows, the **highest** qualifying value is selected to maximize cross-application drift margin (the earlier lowest-qualifying rule sat at the calibration band edge and let drifted negatives through — a tightening, not a loosening).

`corpus` captures the multi-family corpus v2 across real application families (repo Next/Express fixtures, the Arxic login, and the local third-party koel/directus clones via their helper containers) with graded partial clips and negative controls, freezes the seed-423 group allocation (60/20/20, families never split) before training, and labels from independent measured clip fractions:

```bash
pnpm --filter @arxic/web exec tsx src/compact-visual/cli.ts corpus NEW_DIR next,express,arxic,koel,directus 360,640,1024,1280
pnpm --filter @arxic/web exec tsx src/compact-visual/cli.ts corpus NEW_DIR next,express 800   # fixture-only (CI scope)
```

The corpus labels two heads from independent oracles (clipping + scrollport overflow) since scene-measurement v2 — see the [two-head evidence](../../docs/evidence/VISUAL-SLM/corpus-twohead/summary.md) for the first second-head holdout result. The retained [corpus-v2 evidence](../../docs/evidence/VISUAL-SLM/corpus-v2/summary.md) records 179 admitted cases (one honest skip), an untouched koel holdout scoring 20/20 recall with 0 false positives after the threshold-policy tightening — while the spec's uncertainty and incremental-value gates keep promotion blocked.

`ablate.py` masks feature lanes (variants: `geometry`, `image`, `clip-only`, `current-geometry`) over a validated dataset for failure analysis and representation experiments; masking a numeric measurement also masks its validity bit (zero-with-validity-one is a real measurement, not missingness). Use `python3 scripts/visual-slm/ablate.py DATASET VARIANT OUTPUT`, then train the masked dataset normally. The retained [failure analysis](../../docs/evidence/VISUAL-SLM/failure-analysis/summary.md) attributes the initial 0/4 held-out miss to single-application training/calibration plus per-application geometry fingerprints — not to an implementation defect; the current-clip feature alone transfers perfectly, which is exactly why the deterministic check stays preferable for that criterion.

The native binary is a low-level numeric kernel, **not a public untrusted upload API**. The parent checks the model SHA-256, validates evidence, and sends immutable model bytes plus at most 128 float32 feature rows on stdin. Native output contains six float32 scores per row. Model layout is `AVSM0001`, little-endian u32 kind/count, 16 float32 means, 16 stds, then row-major output×input weights and biases for each layer. Counts are 582/logistic and 8,486/MLP; complete artifact sizes are 2,472 and 34,088 bytes. No executable graph or pickle is accepted.

## Resource measurements

`resource_probe.py` runs 1,000 process-per-job native inferences in a Linux cgroup, reporting peak memory, CPU/swap limits and latency. It expects a read-only corpus mounted at `/data` and a compiled Linux-native executable there. Run it using a pinned Python container with `--memory 256m --memory-swap 256m --cpus 1 --network none --read-only`, an unprivileged host-matching UID/GID, and read-only mounts. Keep a manifest of the actual command and container digest beside the output.

The initial kernel+driver result was about 19.3 MiB cgroup peak and 1.5 ms p95; CPU training on 24 rows separately completed in about 0.29 seconds with no OOM events. **Neither measures Chromium, image decoding, server/queue behavior, OS overhead or full-VPS suitability.** Python `ru_maxrss` from a Node-launched process can reflect inherited fork high-water memory; prefer the separately isolated cgroup probe for resource conclusions. A 10,000-row timing claim needs its own measurement.

## Remaining scope and stop conditions

Only viewport clipping has independent labels in this smoke corpus. Missing-element and text-truncation heads are explicitly ineligible because the current scene schema lacks their required evidence. Other numerical heads require applicability and measurements, and remain untrained here. Candidate discovery/localization is not automatic: reports explicitly cover supplied regions (the smoke workflow supplies a whole viewport).

The first implementation uses **positive-only hypotheses and abstention**, not calibrated negative decisions. It reports simple binomial Wilson intervals but not application-cluster confidence, IoU, a chronological holdout, comprehensive drift analysis or a near-duplicate audit. Model promotion stays unconditionally blocked; no automated statistical qualification is implied. The deterministic baseline has no false review alerts in this controlled corpus, so incremental learned value is unproven.

Outstanding spec work includes the broader independently adjudicated corpus, richer scene/label contracts, automatic candidates, full calibration/evaluation gates, atomic deployed model activation/rollback, bounded authenticated service/queue/retention/distribution, real target-VPS qualification, and human screenshot release inspection. The full-stack-versus-analysis-only deployment decision is still unresolved. **GLM's pre-teacher gate is not met.** Future implementation stays with Codex; GLM remains a later optional teacher after those foundational requirements are satisfied.
