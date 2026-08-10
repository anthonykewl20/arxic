# `@arxic/worker`

This app owns the CLI/worker seam, isolation policy, and local Docker-backed
`WorkerClient`. The environment package owns Docker and sandbox mechanics.

The current client starts and supervises the hardened sandbox, streams frozen
diagnostics, and tears down deterministically. It does **not** contain a
packaged stages 0–12 pipeline runtime and its protocol does not return an
auditable pipeline result. Completing that path requires a Node 22 worker image
containing pinned workspace/native/browser/`git`/`sg` runtime artifacts, an
explicit writable artifact transport and quota, declared target/fixture/model
network peers compatible with the internal network, and a structured protocol
payload carrying pipeline state/checkpoints/artifacts/receipt. Callers must fail
closed rather than interpreting a lifecycle-only `completed` handle as a
completed Arxic run.
