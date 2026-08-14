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

## Worker base-image digest refresh

The Dockerfile pins the multi-architecture index digest
`sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436`
for `node:22-slim`.

Pinned: 2026-08-14.

Dependabot opens weekly Docker update PRs for `apps/worker`. To refresh a pin
manually, run `docker buildx imagetools inspect node:22-slim`, confirm its
top-level `Digest` is the multi-architecture index digest, update the
Dockerfile, then run `bash apps/worker/build-and-verify.sh` to rebuild and
prove the root, non-root, and no-egress toolchains.
