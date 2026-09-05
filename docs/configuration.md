# Arxic configuration reference

> **Version: 0.0.200**

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
  provider: gpt-4o-mini
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

| Field             | Required | Type and validation                          | Default |
| ----------------- | -------- | -------------------------------------------- | ------- |
| `domains`         | Yes      | Non-empty array of strings.                  | —       |
| `frameworks`      | Yes      | Non-empty array of strings.                  | —       |
| `browsers`        | Yes      | Exactly `[chromium]`.                        | —       |
| `personas`        | Yes      | Array of strings; it may be empty.           | —       |
| `featureFlags`    | No       | Object whose values are booleans.            | Omitted |
| `inventoryRowIds` | No       | 1–20 unique current source consumer-row IDs. | Omitted |

`inventoryRowIds` restricts AI proposals and post-crawl re-proposals to selected
source rows. Use the `inventoryRowId` values in an existing Intent Ledger, or
`toProposalConsumerInventory` from `@arxic/domain-inventory` on the discovery
inventory. IDs have the form `inv:page:GET:<12 lowercase hex digits>` or
`inv:route:<method>:<12 lowercase hex digits>`; raw inventory keys and frontend
declaration IDs are different identifiers. Each run checks the selection against
its freshly extracted source inventory before inference. Empty, duplicate,
malformed or oversized selections are invalid configuration; stale IDs and an
unavailable model-backed selection path block with `ARXIC-ORCH-WORKFLOW-SCOPE`.
Changed selection invalidates terminal-run reuse.

Omitting the field preserves the existing proposal scope. The full inventory
remains in the ledger; stage 4 records selected and unselected consumer-row IDs.
This engine run still compiles at most one candidate from the selected scope.
Selecting several rows in one engine configuration does not execute a campaign
or establish coverage of all selected rows. The [web campaign interface](web-workbench.md#on-demand-workflow-campaigns)
creates a separate engine run for each selected source row. To exercise a specific supported route, select that single row.
Selection restricts proposal candidates, not prerequisite navigation or discovery
URLs; the existing origin, fixture and mutation policies still apply.

## `target`

| Field                 | Required | Type and validation                                                                                                                                                                                                                                                                                                           |
| --------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `origin`              | Yes      | Non-empty absolute `http:` or `https:` URL without user info. It must be in `allowedOrigins`.                                                                                                                                                                                                                                 |
| `environmentClass`    | Yes      | One of `local-test`, `preview`, or `staging`. Production is refused by the CLI configuration validator.                                                                                                                                                                                                                       |
| `attestationPath`     | Yes      | Absolute-path reference beginning with `/` that resolves on the target origin; network-path and backslash escapes are rejected.                                                                                                                                                                                               |
| `allowedOrigins`      | Yes      | Non-empty array of absolute `http:` or `https:` URLs without user info; it must include `origin`.                                                                                                                                                                                                                             |
| `expectedBuildDigest` | No       | Exactly 64 hexadecimal characters. When set, stage 0 refuses a served attestation whose `buildDigest` differs (`ARXIC-ATTESTATION-BUILD-DIGEST-MISMATCH`) — the operator-side binding from [#259](https://github.com/anthonykewl20/arxic/issues/259). Without it, `local-test` targets are trust-on-first-use for the digest. |

## `policy`

| Field                      | Required | Type and validation                                      | Default |
| -------------------------- | -------- | -------------------------------------------------------- | ------- |
| `maxUrls`                  | Yes      | Integer greater than zero.                               | —       |
| `maxDepth`                 | Yes      | Integer greater than zero.                               | —       |
| `maxRuntimeMinutes`        | Yes      | Integer greater than zero.                               | —       |
| `mutation`                 | Yes      | Literal `leased-fixtures-only`.                          | —       |
| `externalNetwork`          | Yes      | Literal `deny`.                                          | —       |
| `requiredVerificationRuns` | No       | Integer at least two; every requested pass must succeed. | `2`     |
| `screenshots`              | Yes      | Literal `transition-checkpoints`.                        | —       |
| `trace`                    | Yes      | Literal `retain` for managed verification.               | —       |
| `humanApproval`            | Yes      | Array of strings; it may be empty.                       | —       |

`maxRuntimeMinutes` sets the sandbox worker runtime quota. Local execution has
bounded provider/action operations but does not impose a whole-run wall-clock
limit; use worker execution when that isolation and quota are required.

Changed configuration, expected build digest, allowed origins, replay persona,
attestation path, or replay count invalidates terminal-run reuse. Use a new run ID
for a changed request. Standalone replay trace defaults are described in the
[replay guide](./bundle-replay.md).

## `fixtures`

All fixture fields are optional strings. If present, `inbox`, `otp`, and
`personaProvisioner` must be strings; an empty string is accepted by the
configuration validator.

### `replayPersona` — per-pass login for endpoint-less targets (#288)

`fixtures.replayPersona` declares how the verifier provisions the registered
persona against a target that does **not** implement arxic's fixture endpoints
(`POST /__arxic/reset` + `POST /__arxic/seed`) — a vanilla third-party app.
The shape is frozen:

```yaml
fixtures:
  personaProvisioner: boot-seeded-admin
  replayPersona:
    mode: per-pass-login
    login:
      route: /login
      fields:
        - { label: Email, inputRef: persona.email }
        - { label: Password, inputRef: persona.password }
      submit: { label: Login }
```

- `mode` is a closed enum: `per-pass-login` is the only value at freeze.
- `login.route` is an absolute path on the target origin.
- `login.fields` is an ordered list of `{ label, inputRef }`; `inputRef` must
  be one of `persona.email`, `persona.password`, `persona.newpassword`.
- `login.submit` names the form's submit control by label.
- Resolution is **label-first with a fallback** (#295): each declared string
  is matched against the control's accessible label first; when no label
  matches, it is matched against the input placeholder (vanilla SPA targets
  like directus and koel ship placeholder-only login forms). The same
  fallback applies to the submit control (a submit wrapped in `<label>` loses
  its accessible name in Chromium, so its text is matched). SPA targets are
  also given time to hydrate the login form after page load, and hash-router
  or fetch-based logins (no URL change) are detected by the login form's
  declared field leaving the DOM. Failures still classify `blocked` with
  `ARXIC-VERIFY-FIXTURE-LOGIN-BLOCKED`.
- The runtime **surface crawler** uses the same label-first semantics (#297):
  a crawled control's label is its accessible label, then its `<label>` text,
  then its placeholder (an `aria-label` of the literal string `undefined`/`null`
  is treated as an upstream binding artifact, not a label), and each crawled
  URL waits bounded (default 2500ms, `hydrationSettleMs` on the adapter) for a
  form to attach before probing — so hydration-delayed SPA forms are
  inventoried instead of silently dropped.
- The declaration carries **locator metadata only** — persona values never
  appear in YAML; they are supplied exclusively via the
  `ARXIC_INPUT_PERSONA_*` environment channel.

When declared (with a persona configured), the verifier logs the persona in
through the target's own login form **before every verification pass**, in a
fresh browser context per pass — that login is the leased mutation, and no
reset/seed endpoints are called at all. Without the declaration, a
persona-driven run against an endpoint-less target refuses fail-closed at
stage 7 with `ARXIC-VERIFY-FIXTURE-NOT-DECLARED` (the refused reset attempt is
recorded as evidence). A declaration on a `production`-shaped target is
refused with `ARXIC-VERIFY-FIXTURE-PROD-REFUSED` at configuration time, before
any provisioning or login attempt. Failures of the per-pass login itself
classify `blocked` with `ARXIC-VERIFY-FIXTURE-LOGIN-BLOCKED`.

## `models`

| Field             | Required | Type and validation                                                                        |
| ----------------- | -------- | ------------------------------------------------------------------------------------------ |
| `provider`        | Yes      | Non-empty string. `none`, `disabled`, and `unconfigured` do not configure model inference. |
| `sourceRetention` | Yes      | Either `disabled` or `retained`.                                                           |

The YAML configuration names the provider but does not hold its endpoint or
credential. Configure `ARXIC_MODEL_BASE_URL` and `ARXIC_MODEL_API_KEY` when
model inference is needed. Without a configured model, the CLI can still write
an honest partial run rather than inventing a candidate. `ARXIC_MODEL_PRICES`
optionally supplies explicit nonnegative `promptPerMillion` and
`completionPerMillion` rates in USD as JSON for the selected HTTP model, including
custom IDs absent from the built-in table. Unknown prices remain blocked.

### Host-bound model binding (#host-bound-model)

The model layer is transport-agnostic: instead of an HTTP endpoint, it can be
bound to a locally installed agent CLI (Claude Code, Codex CLI, opencode, or
any executable that reads a prompt on stdin and writes a completion on
stdout). Set `ARXIC_MODEL_PROVIDER=host-cli` and `ARXIC_MODEL_HOST_CLI=<path
or name of the executable>` — `ARXIC_MODEL_BASE_URL` and
`ARXIC_MODEL_API_KEY` are then NOT required. Extra argv for the executable is
optional via `ARXIC_MODEL_HOST_CLI_ARGS` (whitespace-separated, or a JSON
array of strings for arguments containing spaces).

To forward the configured model ID, set `ARXIC_MODEL_HOST_CLI_MODEL_ARGS` to a
JSON string array containing a separate `{model}` argument, for example
`["--model", "{model}"]`. It is appended once without a shell. Without this
setting the legacy CLI selects its own model; the recorded requested ID is not
proof of the underlying model. Named [web provider connections](web-workbench.md#provider-connections-and-model-ids) require explicit forwarding.

Library image requests additionally require `ARXIC_MODEL_HOST_CLI_IMAGE_ARGS`,
a JSON array such as `["--image", "{image}"]` matching the installed CLI's actual
attachment syntax. The literal `{image}` must be a separate argument. Each PNG
is attached through a private temporary file and removed after the request.
Missing or malformed image configuration fails closed; ordinary text requests
retain their existing arguments. The dashboard uses this binding after inspected-image authorization for a
retained stable capture; image review receives no persona credentials. See the
[model adapter contract](../packages/model-adapter/README.md#image-evidence).

Because the model does not honour `response_format: json_schema` over this
transport, the adapter relies entirely on the schema-in-prompt path plus its
existing retry-on-invalid-JSON loop — AJV validation and the `schemaVersion`
check are unchanged and still fail closed. The transport strips markdown
fences / preamble prose looking for the first parseable JSON value in the
CLI's stdout, and fails closed (a provider-error diagnostic) if none is
found.

A host-bound CLI does not report token usage. Rather than fabricate a
plausible-looking count, every host-bound run record carries
`tokens: { prompt: 0, completion: 0, total: 0 }` **and** an explicit
`provider: "host-bound"` marker, so a reader can never mistake a genuinely
free, unmetered run for a metered API call that happened to cost nothing.
The pre-call budget estimate is likewise pinned to an explicit zero-price
table entry for this path rather than falling through to
`resolveModelPrices` (which fails closed on an unrecognized model id, or —
the #337 bug this guards against — could otherwise silently reuse another
model's rates).

The subprocess is killed on `ARXIC_MODEL_TIMEOUT_MS` (or the adapter
default). The prompt is passed on the child's stdin, never on argv, so it
never appears in a process listing; the transport never logs the raw
prompt or response outside the existing fail-closed redaction gate.

Since DG-08 (#252), a configured model drives candidate proposals directly
over the Domain Inventory (the canned authentication candidate replacement is
removed), and the per-app cost is capped by a pre-call estimate:
`ARXIC_MODEL_BUDGET_USD` (optional, default `0.0253` — the ADR-008 provisional
budget for a ~340-row application, owner-overridable). A run whose estimated
cost exceeds the cap blocks with `ARXIC-ORCH-MODEL-BUDGET-EXCEEDED` before any
provider call is made.
