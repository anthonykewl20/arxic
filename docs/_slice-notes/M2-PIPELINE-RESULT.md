# M2-PIPELINE-RESULT — staged doc updates (charter §10.2)

Issue: #157 · PR: #168 · Disposition: mixed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #157 | [M2-PIPELINE-RESULT] Worker→CLI pipeline-result protocol envelope | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-13 | **#157 (M2-PIPELINE-RESULT) worker→CLI protocol DONE.** A seam-local versioned PipelineResult projects RunState/checkpoints/artifact refs, a candidate StagedBundle, and a stage-10 authority record over #156's result volume. CLI ingress fail-closes forged verified claims, stale/binding/verifier/hash mismatches, then folds accepted state through runResultFromState and keeps durable promotion CLI-side. Real Docker proved bounded envelope publication, volume import, normalization, cleanup, and a complete ADR §20.1 observed run directory; the real two-app verified candidate awaits #155's pipeline image. Gates recorded in the slice PR. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- M2-PIPELINE-RESULT worker→CLI result protocol (#157): added a bounded versioned pipeline-result envelope over result-volume artifact references, fail-closed CLI validation and local-shape normalization, stage-10 verifier-authority pinning, and CLI-owned candidate promotion; real Docker proves the observed synthetic protocol path while the full two-app pipeline proof remains the #103/#155 integration gate.
```

## 4. `VERSION` bump required?

no

## 5. Evidence pointers

- Real-world proof: `apps/cli/src/__tests__/worker-real-world.test.ts` — a real Docker sandbox writes the envelope and #156 manifest to its result volume; the CLI imports and normalizes them into the ADR §20.1 run directory without claiming verified.
- Artifacts: per-test temporary run directory containing `pipeline-result.json`, `run.json`, `diagnostics.jsonl`, and `config.json`; deleted after inspection.
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (107 files / 925 tests) ☑ · license gate ☑ (covered by the full suite)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                      | Expected disposition                        | Test                                                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Worker asserts `verified` without a stage-10 verifier record | blocked (forged; `ARXIC-WORKER-RUN-FAILED`) | `worker-result-normalize.test.ts` — “rejects a worker-asserted verified value without a stage-10 verifier record as forged” |
| Verifier replay count is stale/inconsistent                  | blocked (`ARXIC-WORKER-RUN-FAILED`)         | `worker-result-normalize.test.ts` — “rejects a stale or replay-inconsistent stage-10 verifier record”                       |
| Imported artifact bytes disagree with the declared hash      | blocked (`ARXIC-EXEC-WORKER-PROTOCOL`)      | `worker-result-normalize.test.ts` — “rejects an artifact hash mismatch against independently imported bytes”                |
| Envelope is absent after lifecycle completion                | blocked; never partial success              | `worker-executor.test.ts` — “blocks a completed handle when its pipeline result is missing”                                 |
