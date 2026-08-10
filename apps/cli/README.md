# `@arxic/cli`

`arxic run --config arxic.yaml` runs locally by default. `--executor local` is
the explicit equivalent. `--executor worker` selects the `WorkerClient`-backed
executor and preserves the same ADR §20.1 run-directory writer.

Worker mode currently fails closed with `ARXIC-EXEC-WORKER-PROTOCOL` after the
isolated worker lifecycle completes: the source-only repository has no packaged
worker runtime/image that can execute stages 0–12, and the current WorkerClient
seam returns lifecycle handles rather than the pipeline `RunState`, checkpoints,
artifacts, and receipt needed to produce an auditable successful run. The
current generic `node:20-alpine` keepalive image also lacks the repository's
Node 22 runtime, installed workspace/native dependencies, Chromium, `git`, and
`sg`; its 8 MiB tmpfs has no separately transported output channel, and its
internal network cannot reach a host-loopback target. The CLI does not treat
the worker's historical no-op completion as pipeline success.
