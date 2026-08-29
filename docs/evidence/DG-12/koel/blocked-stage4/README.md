# Koel DG-12 blocked stage-4 runs

These are retained evidence records, not DG-12 gate runs. `scripts/dg12-lib.mjs`
`loadAppRuns` measures every directory under `runs/` that contains
`artifacts/13.json`; keeping these records under `runs/` would therefore include
them in the measurable run set. The three runs below failed closed at stage 4
with 0 proposals and 0% grounded because of the 30-second model-timeout defect
fixed by PR #345. Measurement must cover only post-fix clean runs.

- `koel-dg12-hostbound-run1`: `ARXIC-ORCH-MODEL-RETRIES`
- `koel-dg12-hostbound-run2`: `ARXIC-ORCH-MODEL-RETRIES`
- `koel-dg12-hostbound-run3`: `ARXIC-ORCH-MODEL-RETRIES` and
  `ARXIC-MODEL-PROVIDER-ERROR`

All three runs have `$0` measured spend. Their ledger entries are retained in
[`../spend-ledger.json`](../spend-ledger.json).

Per ADR-008, no run disappears silently: this relocation is documented here and
on issues #324 and #256. The complete run directories and their top-level JSON
records remain intact in this directory.
