# `@arxic/worker`

This app owns the CLI/worker seam, isolation policy, and local Docker-backed
`WorkerClient`. The environment package owns Docker and sandbox mechanics.

The current client starts and supervises the hardened sandbox, streams frozen
diagnostics, transports quota- and hash-checked artifacts, decodes a structured
pipeline-result protocol, and tears down deterministically. The Node 22 worker
image, artifact transport, and result protocol have landed, but the complete
stages 0–12 worker-backed path has not yet passed its end-to-end two-app proof.
Worker execution therefore remains experimental and non-functional end to end;
callers fail closed rather than interpreting lifecycle completion as a
successful Arxic run.
