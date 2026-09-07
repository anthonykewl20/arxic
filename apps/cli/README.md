# `arxic`

`npm i -g arxic && arxic run --config arxic.yaml`

`arxic run --config arxic.yaml` runs locally by default. `--executor local` is
the explicit equivalent. Local execution drives the pipeline through
verification. See the [architecture summary](../../docs/adr/001-arxic-architecture.md),
especially §19, for the configuration shape.

Without `--out`, run records are stored at `~/.arxic/runs/<repository-sha256-prefix>`;
set `ARXIC_STATE_DIR` to override the `~/.arxic` state base.

`--executor worker` selects the isolated `WorkerClient`-backed path. That mode requires Docker and a worker image built from the same release.
It runs the real pipeline in the sandbox and imports validated artifacts. See
[worker deployment](https://github.com/anthonykewl20/arxic/blob/main/docs/operator/worker-deploy.md).

## Web dashboard

`arxic web` starts the token-authenticated local/server workbench. Set
`ARXIC_ADMIN_TOKEN` (at least 32 characters), `ARXIC_WEB_ROOTS` (a nonempty JSON array
of absolute allowed folders), and optionally `ARXIC_WEB_STATE_DIR`. Install Chromium
with `npx --yes --package=playwright@1.62.1 playwright install chromium` for captures.
The installed command uses bundled frontend assets and compiled jobs; it does not
compile a source checkout at startup. Missing/corrupt assets refuse readiness.
See the [server setup guide](https://github.com/anthonykewl20/arxic/blob/main/docs/web-workbench.md#installed-server-command)
for persistent state, restart behavior, HTTPS proxy settings and runtime prerequisites.
This command is included in locally built tarballs; publication is a separate release step.

## Stage-11 healing in 0.1.0

Healing is not performed in the 0.1.0 pipeline. Each completed run records the
observed `ARXIC-ORCH-HEALING-DEFERRED` diagnostic at stage 11 so this is visible in
the run diagnostics, not a silent gap. 0.1.0 preserves the verifier's existing
non-verified outcome: a failure that a human would call locator or readiness drift is
classified like any other replay failure (`contradicted`), and no distinct
mechanical-drift classification exists in 0.1.0. Arxic does not weaken assertions or
repair the test; the candidate remains unverified and cannot replace a prior promoted
bundle. See [ADR-007](../../docs/adr/007-stage11-healing-deferral.md).

## Release behavior

Managed verification requires at least two clean runs; a larger configured count
is honored. Generated standalone Playwright configs default to trace capture off;
the managed verifier owns trace capture, sanitization, and raw-source deletion.
Promoted directory bundles include a sanitized CycloneDX build-dependency SBOM.
See the [replay guide](https://github.com/anthonykewl20/arxic/blob/main/docs/bundle-replay.md)
for independent execution and screenshot-policy setup.

The web workbench's native account profiles reuse this executor's model adapter.
`ARXIC_MODEL_BILLING_MODE` records `api`, `subscription` or `operator-managed`;
`ARXIC_MODEL_HOST_CLI_JSON_INPUT=1` enables a prompt/schema stdin envelope for native
bridges, while ordinary wrappers retain text input. Named web connections resolve
these settings per job. See [subscription and provider setup](../../docs/web-workbench.md#subscription-accounts-and-provider-catalogs).

### Workflow checkpoint privacy

`policy.checkpointCapture` optionally selects an explicit screenshot capture declaration:

```yaml
policy:
  checkpointCapture:
    mode: approved-region
    region: { kind: role, role: heading, name: Reference Auth App, exact: true }
    masks: []
```

This is an addition to the existing policy fields. The same privacy validator and
runtime apply to local and worker execution. Regions must use an exact accessible
role/name or field label and resolve uniquely at each checkpoint; CSS selectors
and arbitrary script are refused. Use `masked-page` with `fullPage: true` and a
nonempty semantic `masks` list to capture a page with required redactions. Missing or ambiguous regions fail the capture. Missing mask anchors use the
existing broader landmark-mask fallback, recorded by the privacy runtime; if no
bounded fallback exists, capture fails. With no declaration the conservative full-`main`
mask remains. Choose approved test content; this setting is not a claim that
arbitrary pixels are secret-free. Dashboard execution also requires capture consent.

Managed fixture declarations accept only `captured-mail-sink` (inbox), `test-otp`
(OTP), and `app-seed-api` (persona provisioner). CLI validation and worker policy
refuse unknown or malformed names before execution, without echoing supplied
values. These optional declarations name built-in capabilities; they do not load
plugins, supply credentials, or establish fixture readiness. Omission and the
existing per-pass login declaration retain their behavior (refs #452).
