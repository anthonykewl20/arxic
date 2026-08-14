# `arxic`

`npm i -g arxic && arxic run --config arxic.yaml`

`arxic run --config arxic.yaml` runs locally by default. `--executor local` is
the explicit equivalent. Local execution drives the pipeline through
verification. See the [architecture summary](../../docs/adr/001-arxic-architecture.md),
especially §19, for the configuration shape.

`--executor worker` selects the isolated `WorkerClient`-backed path. That mode is
experimental and not yet functional end to end; it fails closed rather than
reporting lifecycle completion as a successful Arxic run.

## Stage-11 healing in 1.0

Healing is not performed in the 1.0 pipeline. Each completed run records the
observed `ARXIC-ORCH-HEALING-DEFERRED` diagnostic at stage 11 so this is visible in
the run diagnostics, not a silent gap. If deterministic replay finds mechanical
drift, Arxic rejects the candidate as `contradicted`; it does not weaken assertions
or repair the test, the candidate remains unverified, and it cannot replace a prior
promoted bundle. See [ADR-007](../../docs/adr/007-stage11-healing-deferral.md).
