# VISUAL-SLM-423 — staged doc updates (charter §10.2)

Issue: #423 · PR: #424 · Disposition: mixed (working experiment; learned quality contradicted)

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
- VISUAL-SLM-423 experimental compact visual-review CLI (refs #423): bounded evidence/features, CPU logistic/MLP training, native parity and hypothesis-only reports; real three-app clipping corpus retains failed learned generalization and explicit promotion/resource gaps. Codex owns implementation; GLM teaching remains deferred.
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
