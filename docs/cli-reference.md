# Arxic CLI reference

> **Version: 0.0.200**

This reference describes the shipped `arxic` command. For a first local run,
use the [quickstart](./quickstart.md); for configuration values, use the
[configuration reference](./configuration.md).

## Synopsis

```text
arxic --help
arxic --version
arxic run --config <path> [--executor <local|worker>] [--out <dir>] [--run-id <id>]
arxic intents <path> [--json]
```

With no arguments, `arxic` prints the top-level help. `--version` prints the
CLI version and `--help` prints the top-level help. The commands are `run` and
`intents`.

### `arxic run`

Start a run from an `arxic.yaml` configuration file.

| Option                       | Required | Meaning                                                                                                                                                     |
| ---------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--config <path>`            | Yes      | Path to the YAML configuration, resolved from the current working directory.                                                                                |
| `--executor <local\|worker>` | No       | Select the executor. The default is `local`; `worker` uses the isolated worker path. See [worker deployment](./operator/worker-deploy.md).                  |
| `--out <dir>`                | No       | Base directory for this run. It is resolved from the current working directory.                                                                             |
| `--run-id <id>`              | No       | An opaque identifier, 1–128 characters: an alphanumeric first character followed by alphanumerics, `.`, `_`, or `-`. A generated UUID is used when omitted. |
| `-h`, `--help`               | No       | Print the `run` usage line.                                                                                                                                 |

Unknown options, positional arguments, missing `--config`, an invalid executor,
or an invalid run ID are usage errors.

### `arxic intents`

Render the intent ledger of a run — the complete, evidence-grounded list of
business intents (ADR-008 Decision 1). The command is strictly read-only: it
never writes files.

`<path>` is one of:

- a run directory (either lane layout — local executor runs, or worker-executor
  runs imported with their nested `artifacts/checkpoints/<run-id>/` layout), or
- an assembled bundle directory (`promoted/<run-id>.bundle/`).

| Option         | Required | Meaning                                                                |
| -------------- | -------- | ---------------------------------------------------------------------- |
| `--json`       | No       | Print the ledger as canonical machine JSON instead of the human table. |
| `-h`, `--help` | No       | Print the `intents` usage line.                                        |

Every run that produced a Domain Inventory (stage 13) carries `intents.json`
at its run root next to `run.json`; promoted runs additionally ship it
hash-covered in the bundle (local lane: bundle-root `intents.json` under
`manifest.fileHashes` + `checksums.sha256`; worker lane: inside the frozen
`promoted/<run-id>.bundle.json`). The table shows one line per intent —
surface, domain, truth state, replay status, proposal id, and the
`inv:` inventory-row linkage — and keeps inventory rows without a proposal
visible with their disposition. Truth state `verified` appears only when the
deterministic verifier produced it; model output can never set it.

Refusals exit non-zero with a stable `ARXIC-INTENT-LEDGER-*` diagnostic and no
partial output: an unrecognized or pre-inventory directory reports
`ARXIC-INTENT-LEDGER-INVENTORY-MISSING`, a missing or unreadable ledger reports
`ARXIC-INTENT-LEDGER-MISSING`/`ARXIC-INTENT-LEDGER-INPUT-INVALID`, and a
schema-invalid ledger or unknown `schemaVersion` reports
`ARXIC-INTENT-LEDGER-SCHEMA-INVALID`/`ARXIC-INTENT-LEDGER-VERSION-UNKNOWN`. A
garbage `PATH` (nonexistent, a plain file, empty) is a usage error
(`ARXIC-CLI-USAGE`, exit 2).

## Environment variables

The CLI reads these variables in its production source. Keep credentials out of
`arxic.yaml` and shell history where practical.

| Variable                          | Required                  | Meaning                                                                                                                                                                                         |
| --------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARXIC_STATE_DIR`                 | No                        | Overrides the state base. Without `--out`, runs are placed under `~/.arxic/runs/<repository-sha256-prefix>/`.                                                                                   |
| `ARXIC_MODEL_BASE_URL`            | Together with API key     | OpenAI-compatible model endpoint. Candidate inference is not configured unless this and `ARXIC_MODEL_API_KEY` are non-empty and `models.provider` is not `none`, `disabled`, or `unconfigured`. |
| `ARXIC_MODEL_API_KEY`             | Together with base URL    | Bearer credential for the model endpoint.                                                                                                                                                       |
| `ARXIC_INPUT_PERSONA_EMAIL`       | With password for persona | Verification persona email. It is used only when it and `ARXIC_INPUT_PERSONA_PASSWORD` are present.                                                                                             |
| `ARXIC_INPUT_PERSONA_PASSWORD`    | With email for persona    | Verification persona password.                                                                                                                                                                  |
| `ARXIC_INPUT_PERSONA_NEWPASSWORD` | No                        | Optional replacement password for the verification persona. It is used only when a persona email and password are present.                                                                      |

`--executor worker` also loads the worker client. Its image selection and
operator settings, including `ARXIC_WORKER_IMAGE`, are documented separately in
[worker deployment](./operator/worker-deploy.md).

### Verifying a third-party target (#288)

arxic's own fixture apps implement `POST /__arxic/reset` + `POST /__arxic/seed`;
vanilla third-party apps do not, so a persona-driven verification run against
one must declare `fixtures.replayPersona` (see
[configuration](./configuration.md#fixtures)). With the declaration, the
verifier logs the persona in through the target's own login form before every
verification pass and never calls the fixture endpoints. Without it, the run
refuses fail-closed at stage 7 with `ARXIC-VERIFY-FIXTURE-NOT-DECLARED` and
zero verification passes. Persona values still enter only via
`ARXIC_INPUT_PERSONA_EMAIL` / `ARXIC_INPUT_PERSONA_PASSWORD` — the declaration
carries locator metadata only, and the values never surface in artifacts,
diagnostics, or logs.

## Output and exit codes

After a run directory is written, standard output has this form:

```text
arxic run <run-id> -> <absolute-run-directory> (status=<status>, outcome=<outcome>)
```

The run directory contains `run.json`, `diagnostics.jsonl`, and `config.json`.
`run.json` records the run ID, redacted configuration, target, status, outcome,
stage checkpoints, artifact hashes, tool versions, decisions, gate results,
redaction result, optional receipt, and diagnostics. `diagnostics.jsonl` is one
canonical diagnostic JSON object per line; `config.json` is the redacted
configuration used for the run.

| Exit | Meaning                                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | A run directory was written and the outcome is `verified`, or `arxic intents` rendered the ledger.                                                                                                            |
| `1`  | A non-`verified` run directory was written, an executor stopped unexpectedly, the run directory could not be written, the CLI encountered an unexpected internal error, or `arxic intents` refused to render. |
| `2`  | Argument usage or configuration was rejected before a run directory existed (includes `arxic intents` with a garbage `PATH`).                                                                                 |

Diagnostics are written to standard error as
`<CODE> [<subject>] <message>`. Configuration failures use
`ARXIC-CONFIG-MISSING`, `ARXIC-CONFIG-PARSE`, `ARXIC-CONFIG-INVALID`,
`ARXIC-CONFIG-VERSION`, or `ARXIC-CONFIG-MODEL-MISSING`; invalid command-line
use uses `ARXIC-CLI-USAGE`; intent-ledger refusals use the
`ARXIC-INTENT-LEDGER-*` family.

## Examples

```sh
# Print the installed CLI version.
arxic --version

# Run locally (the default).
arxic run --config arxic.yaml

# Put a named run in a chosen base directory.
arxic run --config arxic.yaml --out .arxic-runs --run-id local-auth-01

# Use the isolated worker after deploying a matching worker image.
arxic run --config arxic.yaml --executor worker

# Read the intent ledger of a finished run as a human table.
arxic intents .arxic-runs/local-auth-01

# Read the ledger shipped inside a promoted bundle as machine JSON.
arxic intents .arxic-runs/promoted/local-auth-01.bundle --json
```

HTTP model rates can be supplied with `ARXIC_MODEL_PRICES`; host model argument
forwarding uses `ARXIC_MODEL_HOST_CLI_MODEL_ARGS`. See the
[model configuration contract](configuration.md#host-bound-model-binding-host-bound-model)
and [web provider profiles](web-workbench.md#provider-connections-and-model-ids).
