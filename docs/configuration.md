# Arxic configuration reference

> **Version: 0.1.1**

Pass a YAML file to `arxic run --config <path>`. The file must be a plain YAML
object and may contain only the top-level keys below. All listed objects are
required. See the [CLI reference](./cli-reference.md) for the command and
environment variables, and the [attestation guide](./attestation-for-your-app.md)
for the target endpoint.

## Complete example

```yaml
version: 1
source:
  repository: .
  revision: HEAD
  languages: [typescript, javascript]
scope:
  domains: [authentication]
  frameworks: [nextjs]
  browsers: [chromium]
  personas: [anonymous, registered-user]
  featureFlags:
    passwordReset: true
target:
  origin: http://127.0.0.1:3000
  environmentClass: local-test
  attestationPath: /.well-known/arxic-test-target.json
  allowedOrigins: [http://127.0.0.1:3000]
policy:
  maxUrls: 8
  maxDepth: 1
  maxRuntimeMinutes: 30
  mutation: leased-fixtures-only
  externalNetwork: deny
  requiredVerificationRuns: 2
  screenshots: transition-checkpoints
  trace: retain
  humanApproval: [destructive, external-side-effect]
fixtures:
  personaProvisioner: app-seed-api
models:
  provider: configured-adapter
  sourceRetention: disabled
```

## Top-level fields

| Field      | Required | Rules                                                                          |
| ---------- | -------- | ------------------------------------------------------------------------------ |
| `version`  | Yes      | Integer literal `1`.                                                           |
| `source`   | Yes      | Source checkout and revision to inspect.                                       |
| `scope`    | Yes      | Requested domains, frameworks, browsers, personas, and optional feature flags. |
| `target`   | Yes      | Attested application target.                                                   |
| `policy`   | Yes      | Crawl, runtime, verification, and safety settings.                             |
| `fixtures` | Yes      | Optional fixture provider strings.                                             |
| `models`   | Yes      | Model provider and source-retention setting.                                   |

Unknown top-level fields are rejected.

## `source`

| Field        | Required | Type and validation                                              | Default |
| ------------ | -------- | ---------------------------------------------------------------- | ------- |
| `repository` | Yes      | Non-empty string. It is resolved from the CLI working directory. | —       |
| `revision`   | No       | String.                                                          | `HEAD`  |
| `languages`  | Yes      | Non-empty array of strings.                                      | —       |

## `scope`

| Field          | Required | Type and validation                | Default |
| -------------- | -------- | ---------------------------------- | ------- |
| `domains`      | Yes      | Non-empty array of strings.        | —       |
| `frameworks`   | Yes      | Non-empty array of strings.        | —       |
| `browsers`     | Yes      | Array of strings; it may be empty. | —       |
| `personas`     | Yes      | Array of strings; it may be empty. | —       |
| `featureFlags` | No       | Object whose values are booleans.  | Omitted |

## `target`

| Field                 | Required | Type and validation                                                                                                                                                                                                                                                                                                           |
| --------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `origin`              | Yes      | Non-empty absolute `http:` or `https:` URL without user info. It must be in `allowedOrigins`.                                                                                                                                                                                                                                 |
| `environmentClass`    | Yes      | One of `local-test`, `preview`, or `staging`. Production is refused by the CLI configuration validator.                                                                                                                                                                                                                       |
| `attestationPath`     | Yes      | Non-empty string beginning with `/`.                                                                                                                                                                                                                                                                                          |
| `allowedOrigins`      | Yes      | Non-empty array of absolute `http:` or `https:` URLs without user info; it must include `origin`.                                                                                                                                                                                                                             |
| `expectedBuildDigest` | No       | Exactly 64 hexadecimal characters. When set, stage 0 refuses a served attestation whose `buildDigest` differs (`ARXIC-ATTESTATION-BUILD-DIGEST-MISMATCH`) — the operator-side binding from [#259](https://github.com/anthonykewl20/arxic/issues/259). Without it, `local-test` targets are trust-on-first-use for the digest. |

## `policy`

| Field                      | Required | Type and validation                | Default |
| -------------------------- | -------- | ---------------------------------- | ------- |
| `maxUrls`                  | Yes      | Integer greater than zero.         | —       |
| `maxDepth`                 | Yes      | Integer greater than zero.         | —       |
| `maxRuntimeMinutes`        | Yes      | Integer greater than zero.         | —       |
| `mutation`                 | Yes      | Literal `leased-fixtures-only`.    | —       |
| `externalNetwork`          | Yes      | Literal `deny`.                    | —       |
| `requiredVerificationRuns` | No       | Integer greater than zero.         | `2`     |
| `screenshots`              | Yes      | Non-empty string.                  | —       |
| `trace`                    | Yes      | Non-empty string.                  | —       |
| `humanApproval`            | Yes      | Array of strings; it may be empty. | —       |

## `fixtures`

All fixture fields are optional strings. If present, `inbox`, `otp`, and
`personaProvisioner` must be strings; an empty string is accepted by the
configuration validator.

## `models`

| Field             | Required | Type and validation                                                                        |
| ----------------- | -------- | ------------------------------------------------------------------------------------------ |
| `provider`        | Yes      | Non-empty string. `none`, `disabled`, and `unconfigured` do not configure model inference. |
| `sourceRetention` | Yes      | Either `disabled` or `retained`.                                                           |

The YAML configuration names the provider but does not hold its endpoint or
credential. Configure `ARXIC_MODEL_BASE_URL` and `ARXIC_MODEL_API_KEY` when
model inference is needed. Without a configured model, the CLI can still write
an honest partial run rather than inventing a candidate.

Since DG-08 (#252), a configured model drives candidate proposals directly
over the Domain Inventory (the canned authentication candidate replacement is
removed), and the per-app cost is capped by a pre-call estimate:
`ARXIC_MODEL_BUDGET_USD` (optional, default `0.0253` — the ADR-008 provisional
budget for a ~340-row application, owner-overridable). A run whose estimated
cost exceeds the cap blocks with `ARXIC-ORCH-MODEL-BUDGET-EXCEEDED` before any
provider call is made.
