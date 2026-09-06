# VISUAL-SLM resources v2 — analysis-envelope qualification at the corpus-v2 head (refs #423)

Date: 2026-09-06/07. Code: worktree `spike/visual-slm-423` @ `5493c6d` (required `ci` pass, run 34047486104). Predecessor measurements at `d06c2f9`: [VISUAL-SLM summary](../summary.md) (~15.1 MiB native / ~104.8 MiB analysis / 0.30 s 24-row training).

## Scope — analysis-only envelope (spec §3 profile A service mechanics)

Every probe ran in a Linux container with **cgroup 256 MiB memory (swap 0), 1 CPU quota, no network, 64-process limit, read-only mounts, unprivileged matching uid/gid** — the design budget for the analysis service aggregate, not a whole-VM measurement. **Excludes: browser capture, application server, tested apps, OS.** This does not qualify a 512 MiB VPS deployment (profile A or B); it qualifies the bounded mechanics at the new head.

Containers: `python:3.12-slim` (local digest `sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc8c9adf565ae1ac9b536e184ea`) and `node:22.22.0-bookworm-slim` (local digest `sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94`) — the same digests as the retained v1 evidence (the registry stopped serving digest references, so runs reference the tags whose local images verify to these digests; disclosed). Probe inputs: the real corpus-v2 dataset/model (179 rows, dataset sha `deterministic regeneration of the captured corpus`) and a synthetic 10,000-row timing dataset (`gen_timing_dataset.py`, seed 423 — numerically valid, **timing evidence only, never corpus or quality data**).

## Results (all: zero OOM / zero memory-pressure events)

| Probe | Retained result | Artifact |
| --- | --- | --- |
| Native kernel, 1,000 process-per-job inferences + Python driver | p50 1.00 ms · p95 1.28 ms · peak 25.5 MiB | [native-kernel.json](./native-kernel.json) |
| Full PNG→validated evidence→features→native→shadow report, 10 process-per-job jobs (koel 360×800 real case) | p50 1.31 s · p95 1.41 s… see artifact · peak 105.0 MiB | [analysis-path.json](./analysis-path.json) |
| CPU training, **real 179-row corpus**, both models, 30 epochs | 9.29 s wall · 24.1 MiB cgroup peak · 17.9 MiB process RSS | [training-real-179.json](./training-real-179.json) |
| CPU training, **10,000-row synthetic timing** set | logistic 28.1 s (29 epochs) + MLP 128.3 s (early-stop at 8 epochs) = 169.5 s · peak 87.7 MiB; MLP ≈ 16 s/epoch → full 30 epochs ≈ 8 min, vs the spec §11 target ≤ 30 min | [training-timing-10000.json](./training-timing-10000.json) |
| Intake queue mechanics (no-op executor): idempotent re-submission ×12, one active + four queued, sixth submission, deadline path | backpressure on the sixth; 12 idempotent re-submits all return the original id; five-job drain 47 ms; deadline jobs fail open to `failed:deadline-exceeded`; peak 67.4 MiB | [intake-queue.json](./intake-queue.json) |
| **Maximum accepted input**: 2048×1024 pair (exactly the 2,097,152-pixel ceiling), 128 regions, through the real review path | 1.46 s · peak 149.6 MiB · `modelStatus: observed` | [max-input.json](./max-input.json) |

Bound enforcement proved live during probe construction: a first 2048×2048 pair was **rejected** by the evidence contract (`image-bound`: 4.19 M decoded pixels > the 2,097,152 ceiling) and a sharp-generated `pHYs` chunk was **rejected** by the screenshot-privacy PNG inspector — both sad paths fired against this probe's own inputs before the valid-at-ceiling run above.

## Disk and transfer (design arithmetic, not observed months)

Retention is unit-proven (`retention.test.ts`): oldest-first eviction under a byte cap, pinned evidence never deleted, `pinned-exceeds-cap` surfaces for backpressure — the 10 GiB disk budget (≤3 GiB spool, ≥1.5 GiB free reserve) is protected by that service once wired to a deployed spool. Transfer at the 8 MiB image-pair bound: 400 GiB/month (the provisional service cap) ≈ 51,200 pairs before metadata — capacity arithmetic per spec §13, **not** an observed month.

## Reproduce (from the repository root; probe data from a corpus run)

```bash
docker run --rm -u "$(id -u):$(id -g)" --memory 256m --memory-swap 256m --cpus 1 --network none --pids-limit 64 \
  -v <corpus-dir>:/data:ro -v "$PWD/scripts/visual-slm:/scripts:ro" python:3.12-slim python3 /scripts/resource_probe.py
docker run --rm ... -v <corpus-dir>:/data:ro -v "$PWD":/repo:ro node:22.22.0-bookworm-slim node /repo/scripts/visual-slm/analysis_probe.mjs koel-360-clip-full.json
docker run --rm ... -v "$PWD":/repo:ro node:22.22.0-bookworm-slim node /repo/apps/web/node_modules/tsx/dist/cli.mjs /repo/scripts/visual-slm/intake_probe.mts
docker run --rm ... node:22.22.0-bookworm-slim node /repo/apps/web/node_modules/tsx/dist/cli.mjs /repo/scripts/visual-slm/max_input_probe.mts
python3 scripts/visual-slm/gen_timing_dataset.py timing.json --rows 10000 --seed 423
```

## Limitations (explicit)

No browser/server/OS in any measurement; no sustained multi-hour load, no cold-start-vs-warm split for the analysis path at this head, no real-VPS run (none authorized), no OOM-floor sweep, and the queue probe uses a no-op executor (mechanics only). The analysis path peaked at 149.6 MiB at maximum input — inside the 256 MiB service budget but leaving the whole-512-MiB-VM question (profile A/B) open exactly as before. Warm-vs-cold, 1,000-job sustained load, and spool free-reserve admission coupling remain open items for the next resource slice.
