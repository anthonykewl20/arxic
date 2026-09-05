# `arxic`

`npm i -g arxic && arxic run --config arxic.yaml`

`arxic run --config arxic.yaml` runs locally by default. `--executor local` is
the explicit equivalent. Local execution drives the pipeline through
verification. See the [architecture summary](../../docs/adr/001-arxic-architecture.md),
especially §19, for the configuration shape.

Without `--out`, run records are stored at `~/.arxic/runs/<repository-sha256-prefix>`;
set `ARXIC_STATE_DIR` to override the `~/.arxic` state base.

`--executor worker` selects the isolated `WorkerClient`-backed path. That mode requires Docker and a worker image built from the same release.
It runs the real pipeline in the sandbox and imports validated artifacts. See
[worker deployment](https://github.com/anthonykewl20/arxic/blob/main/docs/operator/worker-deploy.md).

## Stage-11 healing in 0.1.0

Healing is not performed in the 0.1.0 pipeline. Each completed run records the
observed `ARXIC-ORCH-HEALING-DEFERRED` diagnostic at stage 11 so this is visible in
the run diagnostics, not a silent gap. 0.1.0 preserves the verifier's existing
non-verified outcome: a failure that a human would call locator or readiness drift is
classified like any other replay failure (`contradicted`), and no distinct
mechanical-drift classification exists in 0.1.0. Arxic does not weaken assertions or
repair the test; the candidate remains unverified and cannot replace a prior promoted
bundle. See [ADR-007](../../docs/adr/007-stage11-healing-deferral.md).

## Release behavior

Managed verification requires at least two clean runs; a larger configured count
is honored. Generated standalone Playwright configs default to trace capture off;
the managed verifier owns trace capture, sanitization, and raw-source deletion.
Promoted directory bundles include a sanitized CycloneDX build-dependency SBOM.
See the [replay guide](https://github.com/anthonykewl20/arxic/blob/main/docs/bundle-replay.md)
for independent execution and screenshot-policy setup.
