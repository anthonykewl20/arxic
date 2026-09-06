# VISUAL-SLM — experimental CPU/native visual-review foundation

Refs [#423](https://github.com/anthonykewl20/arxic/issues/423), [PR #424](https://github.com/anthonykewl20/arxic/pull/424).
Capture/training/inference code: **d06c2f9263094378960d0a7d5d5324e4ba66fe53**.
This records a working experiment and a **failed learned-quality result**, not whole-spec completion, release readiness or GLM-handoff readiness.

## Real-world run

The [corpus](./corpus.json) has 24 actual Chromium cases: Next reference app (training), Express vulnerable reference app (calibration), and the actual anonymous Arxic login screen (test), at widths 640/800/1024/1280 and height 800. Each has a clean and controlled off-viewport submit-button state. No server-side mutation, account login, external teacher or provider stub is involved. Labels come from the explicit required-visible-submit criterion and independently measured viewport intersection. Input fields are masked at capture.

The [foundation report](./foundation-report.json) retains every shadow review, baseline disposition, trained score and failure. [Dataset provenance](./dataset-provenance.json) binds derived rows to the consumed evidence; [training report](./training/training-report.json) records early stopping, class support, thresholds and test metrics. The three-app split is a smoke-specific 1/1/1 allocation, not the spec's promotion corpus. Mutations/viewports of the same application never cross groups. The four held-out positive samples are correlated cases within one app, not four independent applications.

| Check | Result |
| --- | --- |
| Real capture/geometry oracle | PASS: 12 clean required controls remain inside viewport; 12 controlled regressions are outside |
| Evidence integrity | PASS: 168 referenced files hash-checked across 24 manifests; 48 named PNGs, 24 unique byte hashes; 12 clean pairs byte-identical |
| Native/Python exported-model parity | PASS: maximum score difference 1.7532656138019576e-7, below unchanged 1e-5 tolerance |
| Float32 MLP artifact | 8,486 parameters; complete file 34,088 bytes including header/normalization |
| Held-out MLP clipping quality | **FAIL: 0/4 detected positive cases** at calibration threshold; four unresolved positives; 0 false alerts among four negatives |
| Logistic baseline | No qualifying positive threshold on calibration; abstains, no quality pass |
| Deterministic viewport baseline | PASS on the eight held-out cases; four failures retained, four applicable clean checks pass |
| Incremental learned value | **Not demonstrated**; deterministic baseline has no false review alerts in this controlled corpus |
| Production promotion / GLM gate | **Blocked**: insufficient independent corpus and unmet broader implementation/qualification gates |

No matcher, quality threshold or assertion was loosened to hide the quality failure. Reports never turn abstention/no findings into overall pass. Only clipping has training labels; the other five heads remain unsupported in this corpus.

## Inspectable screenshots and action evidence

| App | Before | Current | Scene | Timeline / provenance |
| --- | --- | --- | --- | --- |
| Next, 800px | [visible Login](./next-800-clipped-before.png) | [Login outside viewport](./next-800-clipped-current.png) | [numeric facts](./next-800-clipped-scene.json) | [actions](./next-800-clipped-timeline.json), [provenance](./next-800-clipped-timeline.sanitization.json) |
| Express, 800px | [visible Login](./express-800-clipped-before.png) | [Login outside viewport](./express-800-clipped-current.png) | [numeric facts](./express-800-clipped-scene.json) | [actions](./express-800-clipped-timeline.json), [provenance](./express-800-clipped-timeline.sanitization.json) |
| Arxic, 800px | [visible Open workbench](./arxic-800-clipped-before.png) | [Open workbench outside viewport](./arxic-800-clipped-current.png) | [numeric facts](./arxic-800-clipped-scene.json) | [actions](./arxic-800-clipped-timeline.json), [provenance](./arxic-800-clipped-timeline.sanitization.json) |

All other named cases and adjacent PNG privacy records are indexed by the corpus/manifest files. Scene projections contain only bounded numeric geometry and fixed identifiers; timelines contain allowlisted action labels, not raw traces. Geometry before/after capture is checked for consistency; this is not a claim of atomic whole-scene or paint stability.

The agent reviewed the 24 unique states in four labeled contact sheets; the Arxic 800px clean screen was additionally inspected at full size. Exact-byte comparisons account for the repeated clean images. [Integrity/inspection record](./integrity-review.json). **No human release inspection or arbitrary pixel-secrecy certification is claimed.** Raw trace ZIPs and compiled host executables are not retained. Trained numeric weights are retained for reproducibility and remain experimental.

## Measured resource boundaries

Host: Linux x86_64, Ryzen 7 5700X. Each container used one CPU quota, a 256 MiB aggregate cgroup memory cap, zero swap, no network, read-only mounts, an unprivileged matching UID/GID and a 64-process limit. The host runs other workloads; this is not a dedicated target-VPS benchmark.

| Actual measured scope | Retained result |
| --- | --- |
| 1,000 process-per-job native inferences plus Python driver | [Native resources](./native-resources.json): ~15.1 MiB cgroup peak, ~2.22 ms p95; no OOM events |
| Ten complete PNG → validated evidence → features → native → shadow-report processes plus Node driver, 800×800 | [Analysis resources](./analysis-resources.json): ~104.8 MiB cgroup peak, ~1.41 s p95; no OOM events |
| CPU trainer alone, 24 rows, logistic and MLP with early stopping | [Training resources](./training-resources.json): ~14.3 MiB cgroup peak, ~0.30 s wall time; no OOM events |

Kernel and training container: `python:3.12-slim@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea`.
Analysis container: `node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94`.
Native compiler: Rust 1.89.0, optimized build. Python training dependency set: standard library only. Initial uncapped runs and their timing differ from these final retained probes; no best-run substitution is used here.

The analysis measurement excludes capture/browser, server/queue, tested apps and OS. Maximum accepted image sizes, sustained service load, queue/backpressure, retention, native deployment packaging and actual 512 MiB whole-VM usage remain unmeasured. The 10,000-row CPU-training target is unmeasured. The result does **not** qualify profile A or B for production.

## Reproduction and validation

Use the [experiment README](../../../scripts/visual-slm/README.md). Final capture command from the repository root:

```bash
pnpm --filter @arxic/web exec tsx src/compact-visual/cli.ts demo /tmp/arxic-423-proof-final
```

The output directory must be new. Point `ARXIC_VISUAL_RUSTC` at Rust 1.89.0 where it is not the default compiler. The compiled executable is intentionally omitted from retained evidence; rebuild it from `scripts/visual-slm/native.rs` before reproducing native/resource runs. `resource_probe.py` and `analysis_probe.mjs` preserve the native and full-analysis probe loops; mount a reproduced corpus at `/data` and this checkout at `/repo` for the analysis probe with the pinned images and limits above. Training uses the same pinned Python container, `train.py DATASET NEW_OUTPUT`, and records cgroup files after completion.

Final compact area: **7 tests / 5 files passed** (14.45 s), including actual reference/Arxic capture, altered PNG/privacy/model rejection, shadow hard-failure preservation, model boundary checks, independent feature example and Python/Rust numerical tests. The Python suite executes three tests and the Rust suite two inside the toolchain test. Earlier changed-area run including the existing visual-review UI test passed **8 tests / 6 files** (42.85 s); its unchanged UI assertion exercises the shared pixel comparison. CI-gate unit tests: **6 passed**. Full typecheck and lint passed; license gate rejected **0** packages.

Initial red states were missing implementation modules; subsequent numerical/real-engine tests pass. Typecheck exposed an incorrect fixture cleanup argument and an AJV narrowing issue; both were corrected, then the final capture and real-world test reran. No pre-fix cleanup or stale-head success is claimed. Current-head CI status is recorded on PR #424; local results are not a substitute for `ci` pass.

## Remaining work

See the [full spec](../../visual-small-model-spec.md) and experiment README for explicit gaps. This is an experimental CLI, not the deployed full service. The learned model failed generalization, so additional independently labeled applications and proper untouched evaluation are needed. Automatic candidate localization, richer evidence/adjudication contracts, full calibration/statistics, service admission/activation/rollback/retention, actual VPS proof and human release inspection remain pending. Codex continues to own implementation; **no GLM transmission is authorized by these results**.
