# Arxic quickstart

This is a local-test workflow: Arxic reads a committed source checkout and
refuses a target that does not serve an attestation. It writes run records outside
the source tree by default. The tarball-equivalent install, Chromium setup, and
run below were exercised against the repository's reference-auth-app fixture;
npm publication is the only pending substitution for that tarball.

## Prerequisites and install

- Node.js 22.22 or later.
- Chromium for local execution: run the command below after installation.
- Docker only for `--executor worker` or Testcontainers-backed Mailpit; the local
  no-model path below does not require it.

```sh
npm i -g arxic
arxic --version
npx arxic@latest --version
npx --yes --package=playwright@1.62.1 playwright install chromium
```

The first two installation forms become available when `arxic` is published. The
tarball-equivalent commands used for this walkthrough are recorded in the slice
note; until that release, `npx arxic@latest` returns npm's package-not-found
response.

## Prepare an attested local target

Start a local test deployment of an application you may test. It must serve
`/.well-known/arxic-test-target.json` and its response must name the exact local
origin. The [attestation guide](./attestation-for-your-app.md) defines that
endpoint. This walkthrough uses `http://127.0.0.1:3000`; replace it with your
running target's origin.

From the committed source checkout that corresponds to that target, create
`arxic.yaml`:

```sh
export ARXIC_SOURCE_REPOSITORY="$PWD"
export ARXIC_SOURCE_REVISION="$(git rev-parse HEAD)"
export ARXIC_TARGET_ORIGIN="http://127.0.0.1:3000"
cat > arxic.yaml <<EOF
version: 1
source:
  repository: "$ARXIC_SOURCE_REPOSITORY"
  revision: "$ARXIC_SOURCE_REVISION"
  languages: [typescript, javascript]
scope:
  domains: [authentication]
  frameworks: [nextjs, react]
  browsers: [chromium]
  personas: [anonymous, registered-user]
target:
  origin: "$ARXIC_TARGET_ORIGIN"
  environmentClass: local-test
  attestationPath: /.well-known/arxic-test-target.json
  allowedOrigins: ["$ARXIC_TARGET_ORIGIN"]
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
EOF
```

## Run without a model first

```sh
arxic run --config arxic.yaml
```

With no `ARXIC_MODEL_BASE_URL` and `ARXIC_MODEL_API_KEY`, this command still
performs target attestation and discovery, writes a run directory and diagnostics,
then exits 1 with an honest partial `observed` or `blocked` outcome. It does not
invent a candidate or report `verified`.

To enable stage-4 candidate inference, configure an OpenAI-compatible endpoint
and a credential before rerunning: `ARXIC_MODEL_BASE_URL` identifies the endpoint
and `ARXIC_MODEL_API_KEY` supplies its Bearer credential. For authentication
verification, also supply `ARXIC_INPUT_PERSONA_EMAIL` and
`ARXIC_INPUT_PERSONA_PASSWORD`. A fully eligible candidate still requires two
deterministic verification passes before Arxic exits 0.

For worker execution, add `--executor worker` after configuring Docker; the same
attestation and configuration requirements apply.
