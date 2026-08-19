# DG-11 evidence — real-model validation program (issue #255)

Owner-executable procedure for running REAL model inference through the
production pipeline (`arxic run`) against the owner-ratified targets, within
the owner-set budget, leaving recorded, sanitized validation-run records.
This directory is the evidence home for those records; the tooling lives in
`packages/intent-proposal-spike/scripts/` (`dg11-run-validation.ts` runner,
`validate-records.ts` validator). CI never executes real-model runs (the
`ci` check is stub-model by design); every artifact here was produced by the
owner on a local machine with credentials supplied via environment only.

## Owner decisions in force (from #255)

1. **Ceiling:** USD 1.00 per ratified target, cumulative across ALL DG-11
   validation runs AND DG-12 (#256) exit runs for that app.
2. **Endpoint:** OpenRouter (`https://openrouter.ai/api/v1`), model
   `openai/gpt-4o-mini`, prices 0.15 / 0.60 USD per million tokens
   (prompt/completion) as list-priced at DG-04 measurement.
3. **Targets:** directus @ `cb846b6a1ddc4811359bc52b74bb31a42eab33db` (TS/JS)
   and koel @ `dfec91ff290509c622ff7cf392fb5e506841ee2b` (PHP/Laravel).
4. **Run count:** 1 recorded validation run per target in DG-11.
5. **Groundedness spot-check:** ≥1 proposal per domain hint per recorded run,
   stratified; graded by the owner or a human delegate — never an LLM.

## Pricing re-verification duty (standing)

Prices drift. Before ANY run, the owner re-verifies the per-million list
prices of `openai/gpt-4o-mini` on OpenRouter and passes the verified values
via `ARXIC_DG11_PRICE_PROMPT` / `ARXIC_DG11_PRICE_COMPLETION` if they differ
from the 0.15 / 0.60 defaults. Every run record carries the values actually
used plus a `reverifyNote`; the validator re-computes every recorded cost
from tokens × recorded prices, so a stale price is visible in the record
itself.

## Layout

```
docs/evidence/DG-11/
  README.md                       this procedure
  <target>/arxic.yaml             config TEMPLATE (placeholders; never consumed as-is)
  <target>/spend-ledger.json      per-target cumulative spend ledger (canonical JSON, atomic writes)
  <target>/runs/<runId>.json      validation-run records (dg11-validation-run-v1)
  <target>/refusals/*.json        refusal records (dg11-validation-refusal-v1)
```

## Environment inputs (run mode; never committed, never in CI)

```
ARXIC_MODEL_BASE_URL=https://openrouter.ai/api/v1   # REAL upstream — runner-only
ARXIC_MODEL_API_KEY=<real key>                      # exists ONLY in the runner process
ARXIC_DG11_TARGET_REPO=/abs/path/to/clone           # pristine clone at the pin
ARXIC_DG11_TARGET_APP_ORIGIN=http://127.0.0.1:8055  # the booted target app
ARXIC_DG11_CONFIRM_REAL_SPEND=1                     # explicit spend acknowledgment
# optional
ARXIC_DG11_CEILING_USD=1.0                          # default 1.00 (decision 1)
ARXIC_DG11_PRICE_PROMPT=0.15 ARXIC_DG11_PRICE_COMPLETION=0.60
ARXIC_DG11_ESTIMATED_ROWS=<override>                # defaults: directus 272, koel 239
ARXIC_DG11_RUN_ID=<id>                              # default dg11-<target>-<utc>
ARXIC_DG11_EVIDENCE_DIR=docs/evidence/DG-11         # default
```

## Why a recording proxy (verified mechanism)

The production pipeline DROPS per-call model telemetry: stage 4 consumes only
`response.output` (`packages/orchestrator-langgraph/src/intent-proposer.ts:499-523`)
and the stage-4 artifact whitelist keeps only
requestId/candidates/diagnostics/proposalRun
(`packages/orchestrator-langgraph/src/orchestrator.ts:1806`). The runner
therefore fronts the real endpoint with a local recording proxy: `arxic run`
receives `ARXIC_MODEL_BASE_URL=http://127.0.0.1:<ephemeral>` plus a dummy
canary key; the proxy injects the real `Authorization` ONLY on the upstream
hop and records per call — requestId (response `id`), model,
prompt/completion tokens (response `usage`), latencyMs, and cost at the
declared prices. The real key never appears in arxic's environment, the run
artifacts, or any log line, and is on the sanitizer's forbidden list for
every artifact write.

A second local proxy fronts the booted target: it serves
`/.well-known/arxic-test-target.json` (`environmentClass: local-test`, the
EXACT proxy origin, a fresh nonce, and `buildDigest` = sha256 over the
clone's `git rev-parse HEAD^{tree}`) and forwards everything else to the app.
Vanilla third-party targets pass the preflight handshake this way with ZERO
modification of the pristine clone (the source scanner's dirty-tree guard
stays satisfied).

## Preflight (gate G-4 — zero spend by construction)

```bash
pnpm exec tsx packages/intent-proposal-spike/scripts/dg11-run-validation.ts directus --preflight-only
```

Checks, in order (budget BEFORE credentials, so the budget boundary is
provable with zero credentials and zero spend):

1. **Estimate:** rows × (156 prompt + 85 completion tokens/row) × prices —
   the same DG-04/DG-08 per-row profile the pipeline's own pre-call gate uses
   (`packages/orchestrator-langgraph/src/intent-proposer.ts:73-74,240-250`).
   Row defaults are the measured counts (directus 272 — `docs/evidence/DG-04/scale-matrix.json`;
   koel 239 — DG-05); override with `ARXIC_DG11_ESTIMATED_ROWS`.
2. **Ledger:** `<target>/spend-ledger.json` cumulative spend vs the ceiling.
   Remaining headroom below the estimate → REFUSAL recorded under
   `refusals/`, exit 1, ZERO model calls (this is exactly how G-4 is proven).
3. **Credentials:** absent/blank `ARXIC_MODEL_BASE_URL`/`ARXIC_MODEL_API_KEY`
   → fail-closed refusal (SP-1), zero calls.

## Run steps per target (gate G-3 — owner-executed)

1. **Clone + boot the target** (per-target procedures below). The clone must
   stay clean: `git -C <clone> status --porcelain` must be EMPTY before the
   run (untracked non-ignored files trip the source scanner's dirty-tree
   guard; gitignored build outputs are fine).
2. **Re-verify prices** (see duty above); export the env block.
3. **Preflight** (`--preflight-only`) — confirm estimate vs headroom.
4. **Execute:**

   ```bash
   pnpm exec tsx packages/intent-proposal-spike/scripts/dg11-run-validation.ts directus
   ```

   The runner starts both proxies, rewrites the config template into a temp
   copy, invokes `arxic run` in-process through the sanctioned `runCli`
   boundary (`apps/cli/src/index.ts`; the CLI's own real-world tests prove
   this invocation — `apps/cli/src/__tests__/real-world.test.ts`), and sets
   `ARXIC_MODEL_BUDGET_USD` for the child to the ledger-derived headroom so
   the pipeline's own pre-call gate (default $0.0253,
   `intent-proposer.ts:55`) does not refuse a legitimately-budgeted run —
   the ledger is the authoritative ceiling.

5. **Post-run scans (gates G-1/G-5):**

   ```bash
   pnpm exec tsx packages/intent-proposal-spike/scripts/validate-records.ts docs/evidence/DG-11 \
     --live-key-env ARXIC_MODEL_API_KEY
   ```

   Exit 0 = every record schema-valid, every ledger coherent, zero secret
   findings, live key absent from every file. A planted-secret fixture
   failing this validator is proved in
   `packages/intent-proposal-spike/src/__tests__/real-model.test.ts`.

6. **Groundedness spot-check** (below), then commit the record.

**Honesty note on outcomes:** a DG-11 validation run SUCCEEDS by producing
complete telemetry + coverage + an honest outcome line — the outcome field
may legitimately be a non-verified/blocking pipeline disposition (e.g.
compile blocked OBSERVATION-MISSING without a provisioned persona). The
record's `outcome` block reports whatever actually happened; it is never
massaged.

## Per-target boot procedures (owner-executed, outside this repo)

### directus @ cb846b6a1ddc4811359bc52b74bb31a42eab33db

```bash
git clone https://github.com/directus/directus <clone> && cd <clone>
git checkout cb846b6a1ddc4811359bc52b74bb31a42eab33db
pnpm install
pnpm build
npx directus bootstrap   # creates data.db + admin user (local sqlite)
npx directus start &     # serves on 127.0.0.1:8055 by default
```

Set `ARXIC_DG11_TARGET_APP_ORIGIN=http://127.0.0.1:8055`. The clone stays
pristine — `data.db` and build outputs are gitignored. If the bootstrap
creates untracked non-ignored files, add them to `.git/info/exclude` (local
only — do NOT commit to the clone).

### koel @ dfec91ff290509c622ff7cf392fb5e506841ee2b (PHP/Laravel)

Requires PHP 8.2+, Composer 2, and a local SQL server (SQLite via
`DB_CONNECTION=sqlite` is simplest):

```bash
git clone https://github.com/koel/koel <clone> && cd <clone>
git checkout dfec91ff290509c622ff7cf392fb5e506841ee2b
composer install --no-dev
cp .env.example .env                     # then set DB_CONNECTION=sqlite + APP_KEY
php artisan key:generate --force
php artisan migrate --force
php artisan serve --host=127.0.0.1 --port=8000 &
```

Set `ARXIC_DG11_TARGET_APP_ORIGIN=http://127.0.0.1:8000`. `.env` and the
sqlite file are gitignored. **Read the koel template's FINDING notice first**
(`koel/arxic.yaml`): the truthful `laravel` framework declaration is blocked
today by the missing rulepack — the template documents the `express`
workaround and the follow-up.

## Groundedness spot-check protocol (decision 5, gate for AC-7)

For each recorded run, the owner (or a human delegate — never an LLM,
ADR-001 §2 truth states):

1. Stratifies at least 1 proposal per domain hint present in the run's
   stage-4 proposalRun (sample MORE if budget for attention allows).
2. For each sampled proposal: opens its cited `evidenceRefIds` in the clone
   at the pin and judges whether the proposal's claimed
   domain/intent/action/states are supported by that evidence
   (`grounded` / `ungrounded` + a one-line note).
3. Edits the run record's `groundednessSpotCheck` from
   `{"status":"pending",...}` to `{"status":"completed","sampledAt":...,
"numerator":<grounded>,"denominator":<sampled>,"verdicts":[...]}`.
4. Re-runs the validator (step 5 above) — a record with a pending spot-check
   is flagged `incompleteByDesign` and counts toward no AC (contract C-4).

## Record format (closed schema, `dg11-validation-run-v1`)

Every run record carries EXACTLY these top-level keys (the validator rejects
unknown keys):

| Key                      | Content                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind` / `schemaVersion` | `dg11-validation-run-v1` / `1`                                                                                                                       |
| `target`                 | `{name, repository, commit}` — the ratified pin                                                                                                      |
| `run`                    | `{runId, startedAt, completedAt, executor}`                                                                                                          |
| `model`                  | model id observed on the first upstream response                                                                                                     |
| `pricing`                | `{pricePerMillionPrompt, pricePerMillionCompletion, reverifyNote}`                                                                                   |
| `telemetry[]`            | per call: `{requestId, model, promptTokens, completionTokens, latencyMs, costUsd}`                                                                   |
| `measured`               | `{calls, promptTokens, completionTokens, latencyMsTotal, estimatedCostUsd, measuredCostUsd}`                                                         |
| `ledger`                 | `{before:{cumulativeUsd,ceilingUsd,remainingUsd}, after:{...}}`                                                                                      |
| `coverage`               | `{rows, coveredRows, proposals}` — harvested from the run dir's `artifacts/13.json` (stage-13 inventory) + `artifacts/04.json` (stage-4 proposalRun) |
| `outcome`                | `{exitCode, status, outcome, finalStage}` — honest whatever it is                                                                                    |
| `events[]`               | refusal/redaction events `{type, at, detail}`                                                                                                        |
| `groundednessSpotCheck`  | `pending` until the owner completes it (above)                                                                                                       |

Refusal records (`dg11-validation-refusal-v1`) carry
`{kind, schemaVersion, target, runId, at, reason
(budget-ceiling|credentials-missing|proxy-ceiling|redaction-finding), detail,
estimateUsd?, cumulativeUsd?, ceilingUsd?, remainingUsd?,
upstreamCallsPlaced}` — `upstreamCallsPlaced: 0` on a budget refusal is the
G-4 proof.

The spend ledger (`dg11-spend-ledger-v1`) is canonical JSON, written
atomically (temp + rename, mode 0o640): `{schemaVersion, target,
repository?, commit?, ceilingUsd, cumulativeUsd, entries:[{runId, recordedAt,
measuredCostUsd, calls, valid}]}`. The validator enforces
`cumulativeUsd == Σ entries[].measuredCostUsd` and cross-checks each entry
against its run record.

## Deterministic proofs living in CI (no credentials, no spend)

`packages/intent-proposal-spike/src/__tests__/real-model.test.ts` proves,
on every CI run: budget preflight refusal with zero upstream hits (stub
upstream hit-counter), cumulative-ceiling refusal, mid-run proxy hard-refusal
at the ceiling (HTTP 402 `ARXIC-DG11-SPEND-CEILING`), credential-missing
fail-closed (SP-1), planted-canary redaction fail-closed with nothing
unsanitized written (SP-3/G-5), the validator accept/reject matrix including
the planted-secret negative control (G-1/G-5), ledger arithmetic coherence,
and the attestation well-known shape verified through the PRODUCTION
`verifyAttestation` policy path.
