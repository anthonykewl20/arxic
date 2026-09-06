# VISUAL-SLM-423 — staged doc updates (charter §10.2)

Issue: #423 · PR: #424 · Disposition: mixed (working experiment; learned quality contradicted; failure root-caused to data coverage/calibration; five-family corpus clears the holdout point-gates while uncertainty/incremental-value gates keep promotion blocked; analysis-envelope resource qualification green with explicit scope; gated activation lifecycle proven on real trained artifacts)

## Increment 9 — 2026-09-06/07: free-reserve admission coupling (spec §13, refs #423)

- `retention.freeReserveOk(path, minFreeBytes, statfs?)`: bavail×bsize against the configured reserve; a filesystem that cannot be stat'd fails closed (`disk-reserve-unavailable`), never guessed open.
- `createIntakeQueue` accepts `freeReserve` and refuses admission with `disk-reserve-breach` **before** a queue slot is consumed (spec §13: "Refuse admission before breaching free reserve"); backpressure and all prior sad paths unchanged.
- Red-first (`free-reserve.test.ts`): breach refuses without consuming a slot, healthy reserve admits, stat failure fails closed, and a real-filesystem smoke asserts the primitive measures actual availability both ways.

## Increment 8 — 2026-09-06/07: cross-split duplicate audit (spec §9, refs #423)

- `scripts/visual-slm/duplicate_audit.py` + red-first unit tests (wired into `toolchain.test.ts`): identical image hashes under more than one family fail the audit (leakage); a family seen in two splits fails (split integrity); within-family repeats are counted, not penalized; missing/malformed manifests fail closed.
- Real corpora audited: two-head 195-case corpus — 390 references / 197 unique hashes, **zero cross-group duplicates, zero split violations**, 167 within-family repeats; the 179-case predecessor audits clean identically (206 unique / 358 refs). Retained as [duplicate-audit.json](../evidence/VISUAL-SLM/corpus-twohead/duplicate-audit.json).

## Increment 7 — 2026-09-06/07: scene-measurement v2 — hit-test + overflow evidence, first second-head result (refs #423)

- `measure()` records real hit-test fractions (5×5 `elementFromPoint` grid, spec §8.1 features 10–11) and document-scrollport overflow (12–13) instead of nulls; scenes carry a second deterministic hard check; dataset rows label clipping + overflow from independent per-head oracles; new layout-neutral `overflow-x` variant.
- Browser finding (live-probed): Chromium includes transformed boxes in scrollable overflow (800 px viewport → 3481 px scrollWidth), so clip mutations clamp the scrollport (`overflow: clip`) to keep the two defect classes separable.
- Two-head 5-family corpus: 195 admitted / 5 honest skips — all four directus `overflow-x` cases refused by the overflow oracle (its SPA shell never surfaces the injected width as document overflow; recorded as a coverage gap, never mislabeled).
- koel holdout: **overflow head 4/4 recall, 0 FP across 36 negatives** (first second-head result; wide Wilson bounds with 4 positives); clipping 16/20 / 0 FP — an honest regression vs the clip-only feature set's 20/20, un-attributed (future ablate.py work), no threshold loosened.
- Evidence: `docs/evidence/VISUAL-SLM/corpus-twohead/`.

## Increment 6 — 2026-09-06/07: end-to-end gated model activation on real trained artifacts (refs #423)

- `model-store.ts` + `model-store.test.ts` (red-first) + CLI `activate`/`rollback` verbs: `activateTrainedModel` verifies the manifest→dataset→artifact sha256 bindings, derives the model kind from the artifact header (not caller claims), gates activation on an **independent parity fixture** — the native kernel against the trainer's exported Python scores for the first dataset rows, never recomputed by this path — then stages content-addressed bytes and flips the atomic pointer.
- `stageArtifact` is idempotent for identical bytes and refuses foreign content under a digest name (`stage-conflict`).
- The lifecycle test trains two genuinely different models through the real Python trainer and proves: tampered artifact → `artifact-hash-mismatch`; corrupted parity expectations → `validation-failed`; both leave the active model untouched; a second activation keeps the known-good previous pointer; rollback restores; identical re-staging is idempotent.
- Process note: this increment initially pushed without its slice-note entry — caught and corrected in the follow-up doc commit; superseded-push run cancellation means each push must wait for the previous head's CI.

## Increment 5 — 2026-09-06/07: analysis-envelope resource qualification at the corpus-v2 head (refs #423)

- New probes: `intake_probe.mts` (queue mechanics under cgroup), `max_input_probe.mts` (valid case at the exact 2,097,152-pixel intake ceiling through the real review path), `gen_timing_dataset.py` + `test_timing_dataset.py` (deterministic 10,000-row synthetic timing set; valid rows, timing-only, never corpus data; wired into `toolchain.test.ts`). `analysis_probe.mjs` case name parameterized.
- Retained [resources-v2 evidence](../evidence/VISUAL-SLM/resources-v2/summary.md): constrained containers (256 MiB/1 CPU/no network/64 pids, same image digests as v1 — registry stopped serving digest refs, tags verified locally to those digests, disclosed). Zero OOM everywhere: native kernel p95 1.28 ms / 25.5 MiB; analysis path p95 1.41 s / 105.0 MiB; real-corpus training (179 rows, both models) 9.29 s / 24.1 MiB; 10,000-row timing training 169.5 s total (MLP ≈ 16 s/epoch → ≈ 8 min at 30 epochs, vs the spec ≤ 30-min target) / 87.7 MiB; queue backpressure + idempotence + deadline open-fail 67.4 MiB; max accepted input 1.46 s / 149.6 MiB.
- Bound enforcement proved live against the probe's own inputs: 2048×2048 rejected (`image-bound`, 4.19 M pixels > ceiling) and a sharp `pHYs` chunk rejected by the screenshot-privacy inspector.
- Scope unchanged and explicit: analysis-only envelope; no browser/server/OS; no real-VPS claim; warm/cold split, sustained 1,000-job load, OOM-floor sweep and free-reserve admission coupling remain open.

## Increment 4 — 2026-09-06/07: bounded product-path services — intake, journal recovery, retention, atomic activation (refs #423)

- `intake.ts` (+5 tests): spec §13 bounded admission — one active + at most four queued metadata-only jobs, fifth submission → backpressure, admission validates the case manifest (bounded safe path + schema) before a slot is consumed, per-job 10 s analysis deadline with `deadline-exceeded` recorded and the queue kept serving; idempotent re-submission of a still-pending case returns its original id.
- Journal persistence + recovery: append-only JSONL; a crash leaves interrupted jobs that re-enqueue on construction with their original ids and resume draining; torn final line tolerated and counted, mid-file corruption fails closed (`journal-corrupt`); recovery overflow above the queue bound is recorded `recovery-queue-overflow`, never silently dropped.
- `retention.ts` (+3 tests): spool byte cap with oldest-first eviction, pinned evidence never reclaimed, `pinned-exceeds-cap` reported for caller backpressure; flat operator-owned spool, nothing outside it touched.
- `activation.ts` (+3 tests): content-addressed artifacts, hash + caller validation gate, atomic pointer flip via write-tmp + rename, prior known-good kept in `previous.json`, rollback, torn `active.json.tmp` ignored, failed validation leaves the active model untouched.
- CI defect found and fixed: `corpus.ts` had a local `createHash('sha256')` duplicate — the repo's canonical-implementation contract gate (contracts `canonical.test.ts`) fails the build for production SHA-256 outside `@arxic/contracts`; corpus.ts now imports the shared helper. Local lesson recorded: changed-area tests alone missed this gate; run the contracts suite (or wider) when adding production files.
- Gates: compact-visual 24/24 local (real Chromium suites included), contracts 80/80, typecheck/lint clean.

## Increment 3 — 2026-09-06/07: five-family corpus v2 + tightened threshold calibration (refs #423)

- `corpus.ts`/`corpus-capture.ts`/`train-runner.ts` (+ `corpus.test.ts`, `corpus-real-world.test.ts`, CLI `corpus` command): multi-family capture over the repo Next/Express fixtures, the real Arxic login and the permitted local koel/directus third-party clones (helper containers, ephemeral published ports), with graded partial clips and negative controls; seed-423 group allocation frozen before training (families never split; 3/1/1 for five families); labels from independent measured clip fractions (`evaluateOracle`, 0.12 graded tolerance); shared training mechanics extracted to `train-runner.ts` (native parity chunked to the 128-row kernel bound).
- 179 cases admitted / 1 honest skip; train = express, directus, arxic · calibration = next · **test = koel (untouched)**.
- Threshold policy tightened (red-first in `test_train.py`): `calibrate_thresholds` now selects the **highest** qualifying candidate (calibration precision ≥95 % / recall ≥90 % unchanged) instead of the lowest — the band-edge threshold let drifted koel 360 px negatives through (4 FP). Holdout after tightening: **20/20 recall, 0 FP, parity 1.65e-7**.
- Gates honestly unmet: spec §12 uncertainty intervals fail on sample size (one test family, 36 cases: precision95 lower bound 0.839 < 0.90, FPR95 upper 0.194 > 0.10); incremental value undemonstrated (deterministic oracle is also 20/20 with 0 FP); corpus is between Smoke and Pilot stage (5 families / 179 regions vs the 10-family / 1 000-region pilot minimum). Promotion stays blocked.
- Evidence: `docs/evidence/VISUAL-SLM/corpus-v2/` (summary, corpus manifest, full report, dataset provenance, training report, koel 360 px visual record + representative pairs for every family).
- CI scope note: `corpus-real-world.test.ts` exercises the reduced fixture-only capture (next+express, 800 px, four variants) with allocation-freeze re-derivation and parity; koel/directus runs are dev-machine evidence (docker unavailable in the vitest shards).

## Increment 2 — 2026-09-06/07: deterministic failure analysis (refs #423)

- `scripts/visual-slm/ablate.py` + `test_ablate.py` (red-first; the test caught a real missingness-encoding defect in the first mask): feature-lane ablation tool wired into `toolchain.test.ts`.
- Fresh `cli.ts demo` reproduced the 0/4 held-out miss **byte-identically** (dataset sha `259ca3df…`, all scores/thresholds/parity equal) — the failure is deterministic.
- Four ablations attributed the miss: image lane alone has no signal; geometry-only still fails; **clip-fraction-only transfers perfectly (4/4, 0 FP)**; current-geometry-only ranks correctly within every app with large margins yet still misses through the Express-calibrated absolute threshold. Causes: single-app training/calibration (primary), per-app geometry fingerprints, linear-baseline underfit at this scale. No threshold loosened; deterministic check stays preferable for this criterion.
- The original Arxic holdout is now development data; future generalization claims need ≥5 app families and a fresh untouched holdout (WS2 corpus).
- Evidence: `docs/evidence/VISUAL-SLM/failure-analysis/` (summary.md, analysis.json, five training reports).
- Docs: spec §17 dated addendum (owner directive: GLM Flash continues implementation; teacher gate unchanged), ADR-010 consequence paragraph, scripts README ablate section.

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```text
| #423 | [VISUAL-SLM-423] Experimental evidence/CPU training/native shadow CLI implemented; independent-data quality and full-VPS qualification pending | ☐ open |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```text
| 2026-09-06 | **#423 (VISUAL-SLM-423) experimental foundation implemented.** Real Next/Express/Arxic captures feed bounded 96-feature extraction, standard-library CPU logistic/MLP training and crate-free Rust inference. Native parity is within 1e-5. Initial held-out Arxic clipping recall is 0/4 at the calibrated threshold; deterministic checks preserve all failures. Kernel/trainer cgroup probes are preliminary, not full-VPS proof. No GLM calls or model promotion. Next: independent corpus and unresolved spec gates; #423 stays open. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```text
- VISUAL-SLM-423 experimental compact visual-review CLI (refs #423): bounded evidence/features, CPU logistic/MLP training, native parity and hypothesis-only reports; real three-app clipping corpus retains failed learned generalization and explicit promotion/resource gaps. Added feature-lane ablation tooling and a deterministic failure analysis attributing the held-out miss to single-application training/calibration plus per-application geometry fingerprints, then a five-family corpus (repo fixtures + Arxic + local koel/directus clones) with frozen seed-423 group allocation and tightened highest-qualifying threshold calibration: untouched koel holdout 20/20 recall with 0 false positives while uncertainty/incremental-value gates keep promotion blocked. Spec 17 addendum records the owner directive that GLM Flash continues implementation; teacher gate unchanged.
```

## 4. `VERSION` bump required?

Yes, at integration: next owner-defined patch increment for the newly documented experimental CLI. This worktree does not edit VERSION or manifests. The integrator must reconcile the next patch with any concurrent release changes.

## 5. Evidence pointers

- Design/current boundaries: `docs/visual-small-model-spec.md` and `scripts/visual-slm/README.md`.
- Actual real-engine test: `apps/web/src/compact-visual/real-world.test.ts`.
- Numerical tests: `scripts/visual-slm/test_train.py` and native Rust tests, executed by `toolchain.test.ts` in CI.
- Retained proof: `docs/evidence/VISUAL-SLM/summary.md` (prepared after final code capture).
- Local checks: eight changed-area tests including the existing visual-review UI test; typecheck and full lint passed; license gate rejected zero packages. The final model-failure fallback test additionally passed (14.01 s) after a red-first fix preserving hard findings. Current-head CI is pending.
- Full-repo format check is rerun after this note. Report its actual last line with the final checks.
- Deferred: full corpus/quality gates, automatic candidate localization, richer scene/label schemas, deployed service/activation/rollback, actual target VM and human screenshot release inspection. This is not whole-spec completion or permission for GLM handoff.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                 | Expected disposition                                 | Test                                 |
| ----------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------ |
| Invalid/oversized manifest or traversal                                 | Blocked before image processing                      | evidence.test.ts                     |
| Altered real screenshot/privacy/model bytes                             | Blocked before inference                             | real-world.test.ts                   |
| Wholly masked evidence or missing measurements                          | Abstention; no pass                                  | features.test.ts                     |
| Invalid model/promotion claims                                          | Rejected                                             | model.test.ts                        |
| Hard failure with no model findings                                     | Hard failure preserved                               | model.test.ts and real-world.test.ts |
| Cross-group split leakage/non-finite training input/no supported labels | Training refused                                     | test_train.py                        |
| Invalid native header/shape/NaN weights                                 | Native process refuses                               | native.rs tests                      |
| Learned held-out clipping miss                                          | Quality gate remains blocked, no threshold loosening | retained training/foundation reports |
