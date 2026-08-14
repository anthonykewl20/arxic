# `arxic`

`npm i -g arxic && arxic run --config arxic.yaml`

`arxic run --config arxic.yaml` runs locally by default. `--executor local` is
the explicit equivalent. Local execution drives the pipeline through
verification. See the [architecture summary](../../docs/adr/001-arxic-architecture.md),
especially §19, for the configuration shape.

Without `--out`, run records are stored at `~/.arxic/runs/<repository-sha256-prefix>`;
set `ARXIC_STATE_DIR` to override the `~/.arxic` state base.

`--executor worker` selects the isolated `WorkerClient`-backed path. That mode is
experimental and not yet functional end to end; it fails closed rather than
reporting lifecycle completion as a successful Arxic run.
