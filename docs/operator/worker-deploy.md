# Worker deployment and source-hash lockstep

`arxic run --executor worker` is a two-party deployment: the CLI verifies the
worker's result, so deploy the CLI and worker image from the same Git revision.
This is a correctness requirement, not a rolling-upgrade compatibility mode.

## Why lockstep is required

The launcher mounts the target source read-only at `/work/source` and rewrites
the worker run specification to that path. The worker hashes that mounted tree
as a bytewise, canonical manifest and returns `sourceSha256` with its result.
The CLI independently computes the trusted staged-source hash and blocks a
result whose `sourceSha256` differs. An old worker and new CLI can therefore
fail closed when their source-hash implementations or included-source rules
differ.

The image also contains the checked-out Arxic source and built worker program:
the Dockerfile copies the build context into `/app` before installing and
building the worker. Building the image from a different revision than the
installed CLI risks running different hashing and protocol code.

### Upgrade procedure

1. Check out the revision that will supply the CLI and worker.
2. Build and verify the image from that checkout with
   `apps/worker/build-and-verify.sh` (or an equivalent `docker build` from the
   repository root using `apps/worker/Dockerfile`).
3. Deploy that image with the CLI from the same revision. If the tag is not
   `arxic-worker:dev`, set `ARXIC_WORKER_IMAGE` for the CLI process.
4. Run `arxic run --executor worker --config arxic.yaml` against a safe,
   attested target. A source-hash mismatch is a deployment failure: rebuild and
   redeploy the matching image/CLI pair; do not bypass the check.

## Operator environment

Values below are the operator-facing settings relevant to worker deployment,
attestation, and Mailpit. Keep secrets in the deployment secret store, never
in `arxic.yaml` or a shell history.

| Setting                             | Type and default                                             | When to set it                                                                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARXIC_WORKER_IMAGE`                | string; `arxic-worker:dev`                                   | Selects the worker image tag used by the local worker client. Set it for a non-default tag built from the matching revision.                                                                                    |
| `WORKER_SOURCE_PATH`                | **Not an environment variable**; fixed string `/work/source` | No operator setting. The client rewrites the repository path to this container path and the sandbox bind-mounts the source there read-only.                                                                     |
| `ARXIC_ATTESTATION_ALLOWED_ORIGINS` | comma-separated origin strings; empty by default             | Adds operator-approved origins to attestation policy. Use only for explicitly approved non-local targets.                                                                                                       |
| `ARXIC_ATTESTATION_RECEIPT_KEY`     | non-empty secret string; absent by default                   | Supplies the HMAC key for signed attestations. Non-`local-test` attestations require a valid signed receipt, so configure this on both the CLI side and the target's receipt producer when using such a target. |
| `ARXIC_MAILPIT_SMTP`                | string; no default                                           | Set together with `ARXIC_MAILPIT_API` to use an already-running Mailpit service for fixture email.                                                                                                              |
| `ARXIC_MAILPIT_API`                 | string URL; no default                                       | Set together with `ARXIC_MAILPIT_SMTP`; otherwise the real fixture adapter starts an isolated Mailpit Testcontainer.                                                                                            |

`ARXIC_MODEL_BASE_URL`, `ARXIC_MODEL_API_KEY`,
`ARXIC_INPUT_PERSONA_EMAIL`, `ARXIC_INPUT_PERSONA_PASSWORD`, and
`ARXIC_INPUT_PERSONA_NEWPASSWORD` are forwarded into the worker process
environment by the CLI worker client. Set them for model or persona configuration
of the run, not for image deployment.

`ARXIC_ATTESTATION_NONCE` is not read as an operator setting by the CLI or
worker. It is commonly consumed by the target application's attestation route;
the CLI obtains its expected nonce from configuration and validates the served
value.

## Code provenance

| Claim                                                             | Verified source                                                                                                                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default image and `ARXIC_WORKER_IMAGE` override                   | `apps/worker/src/worker-client.ts:101-117`                                                                                                                              |
| Source-path rewrite and source bind mount                         | `apps/worker/src/worker-client.ts:149-190`; `packages/environment/src/worker-sandbox.ts:256-300`                                                                        |
| Canonical manifest over staged source bytes                       | `apps/worker/src/source-tree-hash.ts:22-63`                                                                                                                             |
| Worker hash emission and CLI mismatch rejection                   | `apps/worker/src/main.ts:426-449`; `apps/cli/src/worker-result-normalize.ts:83-93`                                                                                      |
| Image copies source and builds worker                             | `apps/worker/Dockerfile:32-43`; `apps/worker/build-and-verify.sh:4-10`                                                                                                  |
| Attestation environment parsing and non-local receipt requirement | `packages/environment/src/attestation-policy.ts:3-39`; `packages/orchestrator-langgraph/src/orchestrator.ts:470-480`; `packages/environment/src/attestation.ts:211-245` |
| Mailpit configured-service/Testcontainer selection                | `packages/fixture-mailpit/src/real-world.test.ts:31-51`                                                                                                                 |
| Model and persona run-environment forwarding                      | `apps/worker/src/worker-client.ts:157-169`                                                                                                                              |
