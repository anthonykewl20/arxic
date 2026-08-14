# Attestation for your app

Arxic refuses to test a target until the target identifies the exact environment and build being tested. Your app must serve an HTTP `GET` endpoint at:

```text
/.well-known/arxic-test-target.json
```

The endpoint must return JSON with this shape:

```json
{
  "environmentClass": "local-test",
  "origin": "http://127.0.0.1:3000",
  "allowedOrigins": ["http://127.0.0.1:3000"],
  "buildDigest": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "nonce": "my-app-local-v1"
}
```

The fields are:

- `environmentClass`: the deployment class. Use `local-test` for a development target. The attestation policy also defaults to allowing `preview`; the CLI config accepts `local-test`, `preview`, and `staging`. A production-named class or public hostname is production-looking and is refused by default. The environment attestation API can permit such a target only with a recorded human approval containing `approver`, `approvedAt`, and `reason`; the current CLI does not expose that production override and rejects production config.
- `origin`: the exact web origin Arxic will test: scheme, hostname, and port, with no path. It must exactly match `target.origin`.
- `allowedOrigins`: origins the app itself permits Arxic to use. It must contain the exact target origin, which must also appear in `target.allowedOrigins` in `arxic.yaml`.
- `buildDigest`: a 64-hex-character SHA-256 identifying the app build. Hash a stable build identifier or, preferably, a deterministic manifest of the deployed build outputs. Recompute it whenever deployable app bytes change. For example, the reference Next.js app hashes `.next/BUILD_ID` with SHA-256 (and hashes a stable development identifier when no build ID exists).
- `nonce`: a non-empty freshness/binding value. If the operator configures an expected nonce, this value must match it exactly.

The lower-level attestation contract also supports a `signedReceipt` string. It
is an HMAC-SHA-256 over `<buildDigest>.<nonce>`. A `local-test` target does not
need one by default; every non-`local-test` target requires a valid receipt and
the CLI-side `ARXIC_ATTESTATION_RECEIPT_KEY`. Configure
`ARXIC_ATTESTATION_ALLOWED_ORIGINS` only for operator-approved origins. See
[worker deployment and source-hash lockstep](operator/worker-deploy.md) for
the operator settings and code provenance.

## Minimal route handler

This Next.js-style handler follows the same contract as Arxic's reference app:

```ts
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

function buildDigest(): string {
  const buildId = readFileSync('.next/BUILD_ID', 'utf8').trim();
  return createHash('sha256').update(buildId).digest('hex');
}

export function GET(request: Request): Response {
  const origin = new URL(request.url).origin;
  return Response.json({
    environmentClass: 'local-test',
    origin,
    allowedOrigins: [origin],
    buildDigest: buildDigest(),
    nonce: process.env.ARXIC_ATTESTATION_NONCE || 'my-app-local-v1',
  });
}
```

For a static development server, the same object can instead be written to `public/.well-known/arxic-test-target.json`; update its `origin`, `buildDigest`, and `nonce` for the build being served.

## Configure `arxic.yaml`

Alongside the attestation endpoint, provide the complete [ADR §19 configuration](./adr/001-arxic-architecture.md#19-configuration). In particular:

- `source.repository` points to the checked-out source repository and `source.revision` identifies the commit or revision to inspect.
- `target.origin` exactly matches the attested origin; set `target.attestationPath` to `/.well-known/arxic-test-target.json` and include the origin in `target.allowedOrigins`.
- `models.provider` names your configured OpenAI-compatible model provider. Set `ARXIC_MODEL_BASE_URL` and `ARXIC_MODEL_API_KEY` in the environment; credentials do not belong in YAML.
- Configure the scope, safety policy, and any fixtures your workflows require. Auth verification can use `ARXIC_INPUT_PERSONA_EMAIL`, `ARXIC_INPUT_PERSONA_PASSWORD`, and optionally `ARXIC_INPUT_PERSONA_NEWPASSWORD`.
- Mailpit is optional unless a workflow needs captured email. Fixture development can use `ARXIC_MAILPIT_SMTP` and `ARXIC_MAILPIT_API`, or let Arxic's fixture integration start an isolated Mailpit Testcontainer. Docker is therefore optional for a plain local run, but required for Testcontainers-backed Mailpit and for `--executor worker`.

Run:

```sh
arxic run --config arxic.yaml
```

Run records, diagnostics, stage checkpoints, and artifact hashes follow the [ADR §20 operational model](./adr/001-arxic-architecture.md#20-operational-model).

## Current inference limitation

Candidate inference reliably covers the supported authentication-app topology and a root-route fallback. Arbitrary applications may need richer, evidence-driven inference before Arxic can produce useful promotable candidates; that generalization is tracked work. Do not interpret a sparse or blocked result on an unsupported topology as proof that the application has no relevant behavior.

See also [ADR §16.2](./adr/001-arxic-architecture.md#162-test-target-attestation) for the target-attestation security policy.
