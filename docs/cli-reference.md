# Arxic CLI reference

> **Version: 0.1.1**

This reference describes the shipped `arxic` command. For a first local run,
use the [quickstart](./quickstart.md); for configuration values, use the
[configuration reference](./configuration.md).

## Synopsis

```text
arxic --help
arxic --version
arxic run --config <path> [--executor <local|worker>] [--out <dir>] [--run-id <id>]
```

With no arguments, `arxic` prints the top-level help. `--version` prints the
CLI version and `--help` prints the top-level help. The only command is `run`.

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

| Exit | Meaning                                                                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | A run directory was written and the outcome is `verified`.                                                                                                                 |
| `1`  | A non-`verified` run directory was written, an executor stopped unexpectedly, the run directory could not be written, or the CLI encountered an unexpected internal error. |
| `2`  | Argument usage or configuration was rejected before a run directory existed.                                                                                               |

Diagnostics are written to standard error as
`<CODE> [<subject>] <message>`. Configuration failures use
`ARXIC-CONFIG-MISSING`, `ARXIC-CONFIG-PARSE`, `ARXIC-CONFIG-INVALID`,
`ARXIC-CONFIG-VERSION`, or `ARXIC-CONFIG-MODEL-MISSING`; invalid command-line
use uses `ARXIC-CLI-USAGE`.

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
```
