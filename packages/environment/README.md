# @arxic/environment

M0-11 implements the stage-zero target-attestation handshake from ADR §16.2. `EnvironmentHandshake.attest()` performs a real fetch of `/.well-known/arxic-test-target.json`, validates the response shape, applies policy, and always returns a structured allowed/refused decision record with stable blocked diagnostics.

## Default-deny policy

The request origin must exactly equal the attested origin and occur in both the attestation and policy allowlists. Environment classes default to `local-test` and `preview`. A configured nonce must match. Production-named environments and public hostnames outside loopback, RFC1918, `.test`, `.example`, and `.local` are production-looking and refused by default.

When `requireSignedReceipt` is enabled, the target must supply `signedReceipt`, encoded as lowercase or uppercase hexadecimal HMAC-SHA256 over `<buildDigest>.<nonce>` using `receiptKey`. The canonical fixture apps use static test nonces and therefore use `expectedNonce` rather than signed receipts.

A production-looking target can pass only through `humanApprovals[origin]` in static policy. The record must include string values for `approver`, `approvedAt`, and `reason`; malformed records fail as missing approvals. The accepted override is copied into the decision record. Models receive no API that can populate approvals. Origin, nonce, and receipt checks remain fail-closed when an approval exists.

Live fetches fail closed after `attestationTimeoutMs`, which defaults to 10 seconds. Timeout, network, HTTP, JSON, and shape failures return `ARXIC-ATTESTATION-FETCH-FAILED` and a refused decision.

## PREFLIGHT

`runPreflightAttestation()` composes `EnvironmentHandshake.attest()` across a target set and classifies target IDs into `accepted` and `refused`. It writes deterministic canonical JSON to `preflight-attestation.json` under the requested artifacts directory, recording every target's origin, environment class, disposition, reason, policy version, timestamp, and any recorded override. Artifact write failures return `ARXIC-ATTESTATION-ARTIFACT-WRITE-FAILED` as a blocked diagnostic without changing the handshake decisions.

The PREFLIGHT acceptance gate admits both real reference apps as `local-test` under exact-origin and nonce policy. Production-styled targets remain refused by default and are recorded as refused in the same run artifact.

## Public API

- `EnvironmentHandshake.attest(request, policy)` fetches and evaluates the live endpoint.
- `runPreflightAttestation(input)` runs the handshake for all targets and records their decisions.
- `verifyAttestation(attestation, request, policy)` is the pure policy action.
- `classifyTarget(target)` exposes the deterministic production-looking heuristic.
- `ATTESTATION_DIAGNOSTIC_CODES` enumerates every stable `ARXIC-ATTESTATION-*` diagnostic.

## Layering

`service.ts` owns reusable mechanics: real HTTP fetch, shape parsing, and HMAC verification. `index.ts` is the Actions/policy layer: production-looking classification, exact-origin authorization, environment and approval policy, failure classification, and decision construction. `diagnostics.ts` manufactures stable diagnostics and rejects any diagnostic that fails the frozen `@arxic/contracts` validator. This follows the charter §1 and §5 seam 3 without modifying frozen contracts.

Worker sandbox enforcement, action-class policy, and live Testcontainers isolation remain separate orchestration responsibilities (ADR §16.1, §16.3–§16.5). Their required boundary is specified in `docs/threat-model.md`; live worker enforcement is validated in M1 #26.
