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
ARXIC_DG11_CEILING_USD=1.0                          # default 1.00 (decision 1); must MATCH the
                                                    # ledger ceiling once the ledger exists
ARXIC_DG11_PRICE_PROMPT=0.15 ARXIC_DG11_PRICE_COMPLETION=0.60   # both strictly > 0
ARXIC_DG11_ESTIMATED_ROWS=<override>                # defaults: directus 272, koel 239
ARXIC_DG11_RUN_ID=<id>                              # default dg11-<target>-<utc>; must match
                                                    # ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$
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

Two hardening properties of these proxies (dual-review remediation on PR
#284):

- **Inbound authentication:** the recording proxy accepts ONLY requests
  whose Authorization header carries this run's dummy canary token
  (`dg11-canary-…`). Every other local caller gets a static 401 and is
  never forwarded — a process that discovers the ephemeral port cannot
  spend the real key.
- **Origin pinning:** the attestation front resolves every request target
  against the app origin and 404s anything that resolves elsewhere
  (absolute-form targets, `//host`, `/\host` all resolve to foreign origins
  under WHATWG URL semantics and are rejected).

## Preflight (gate G-4 — zero spend by construction)

```bash
pnpm exec tsx packages/intent-proposal-spike/scripts/dg11-run-validation.ts directus --preflight-only
```

Checks, in order (each refuses fail-closed with ZERO model calls; budget
BEFORE credentials, so the budget boundary is provable with zero credentials
and zero spend):

1. **Ledger integrity:** `<target>/spend-ledger.json` must parse AND validate
   (schema + `cumulativeUsd == Σ entries`). A missing file is a legitimate
   fresh ledger; anything else → refusal `ledger-unreadable` naming the path
   and the failure — the file is never rewritten, repair it manually (below).
2. **Ceiling agreement:** if `ARXIC_DG11_CEILING_USD` is set while a ledger
   already exists, the values must match, else refusal `ceiling-mismatch`
   naming both values (adoption is manual — below). Unset = the ledger's
   ceiling is authoritative.
3. **Prices strictly positive:** `ARXIC_DG11_PRICE_PROMPT` /
   `ARXIC_DG11_PRICE_COMPLETION` must BOTH be > 0, else refusal `zero-price`
   — zero prices would zero every estimate and recorded cost and the ceiling
   could never trip.
4. **Estimate:** rows × (156 prompt + 85 completion tokens/row) × prices —
   the same DG-04/DG-08 per-row profile the pipeline's own pre-call gate uses
   (`packages/orchestrator-langgraph/src/intent-proposer.ts:73-74,240-250`).
   Row defaults are the measured counts (directus 272 — `docs/evidence/DG-04/scale-matrix.json`;
   koel 239 — DG-05); override with `ARXIC_DG11_ESTIMATED_ROWS`.
5. **Budget:** ledger cumulative spend vs the ceiling. Remaining headroom
   below the estimate → REFUSAL recorded under `refusals/`, exit 1, ZERO
   model calls (this is exactly how G-4 is proven).
6. **Credentials:** absent/blank `ARXIC_MODEL_BASE_URL`/`ARXIC_MODEL_API_KEY`
   → fail-closed refusal (SP-1), zero calls.

## Run steps per target (gate G-3 — owner-executed)

1. **Clone + boot the target** (per-target procedures below). The clone must
   stay clean: `git -C <clone> status --porcelain` must be EMPTY before the
   run (untracked non-ignored files trip the source scanner's dirty-tree
   guard; gitignored build outputs are fine). The runner ASSERTS the clone's
   real HEAD equals the ratified pin before anything can spend — a drifted
   HEAD refuses (`commit-mismatch`, zero model calls). The record's commit is
   observed, never assumed.
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

   After the child exits, the recording proxy DRAINS in-flight upstream
   forwards (bounded by the upstream timeout) before the record is built,
   then reconciles forwarded calls vs telemetry rows. Any gap → an
   `accounting-gap` event, the ledger entry is written `valid: false` with
   `accountingGap: true`, remaining headroom freezes to $0, and the runner
   exits 1 — repair the ledger manually (below). Cumulative spend may exceed
   the ceiling by at most one call (the proxy checks the ceiling BEFORE
   forwarding); such a run records a `ceiling-overshoot` event and clamps
   `remainingUsd` to 0 rather than self-invalidating with a negative value.

5. **Post-run scans (gates G-1/G-5):**

   ```bash
   pnpm exec tsx packages/intent-proposal-spike/scripts/validate-records.ts docs/evidence/DG-11 \
     --live-key-env ARXIC_MODEL_API_KEY
   ```

   Exit 0 = every record schema-valid, every ledger coherent, every run
   record accounted by a ledger entry, zero secret findings, live key absent
   from every file. A planted-secret fixture failing this validator is proved
   in `packages/intent-proposal-spike/src/__tests__/real-model.test.ts`.

   `--live-key-env` FAILS (exit 1) when the named variable is unset, empty,
   or the flag has no value — a silent skip must never read as a clean scan.
   Pass `--allow-missing-live-key` only when you deliberately run the
   validator without credentials and accept the skipped scan.

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

## Single-runner discipline (accepted residual)

The spend ledger has NO cross-process lock: two runners executing the same
target concurrently could interleave reads/writes and overcount headroom.
**Discipline: at most ONE runner per target at a time.** Before a run,
confirm no other DG-11/DG-12 runner is active for that target (an in-flight
run holds a local recording proxy; `ss -ltnp | grep tsx` on the runner
machine is a cheap check). This concurrency gap is an ACCEPTED residual of
the owner-executed, single-machine procedure — not a tooling guarantee. The
validator's `cumulativeUsd == Σ entries` coherence check catches a botched
interleave after the fact, but prevention is procedural.

## Manual ledger repair & ceiling adoption

Fail-closed states (corrupt ledger, accounting gap, ceiling change) never
resolve automatically — the owner repairs the JSON by hand, then re-runs the
validator until it passes:

- **Corrupt / unparseable ledger (preflight `ledger-unreadable`):** stop all
  runners; inspect `<target>/spend-ledger.json`; fix the JSON so it parses
  and `cumulativeUsd == Σ entries[].measuredCostUsd` over the entries you can
  verify against the run records under `<target>/runs/`. Never invent
  entries: if a run's record exists but its entry is unrecoverable, prefer
  understating nothing — document the incident on #255 and treat headroom as
  consumed. Re-run the validator before any new run.
- **Post-run ledger failure (`ledger-unreadable` after spend):** the run
  record WAS written but no ledger entry could be appended — the validator
  flags the record as unaccounted until you append the entry by hand
  (`{runId, recordedAt, measuredCostUsd, calls, valid: false}` matching the
  record's `measured.measuredCostUsd`), then re-validate.
- **Accounting gap (`accounting-gap` event, headroom frozen to $0):** the run
  forwarded calls whose telemetry never landed. Reconcile against the
  provider's usage dashboard; edit the run's ledger entry to the reconciled
  `measuredCostUsd`, correct `cumulativeUsd` to the new Σ, and REMOVE the
  entry's `"accountingGap": true` to unfreeze headroom. If reconciliation is
  impossible, leave the freeze in place — the target's budget is spent.
- **Ceiling adoption (`ceiling-mismatch`):** to raise/lower a target's
  ceiling, edit the ledger's `ceilingUsd` field by hand (a single-field
  edit; entries and cumulative are unaffected), note the decision on #255,
  and keep passing the matching `ARXIC_DG11_CEILING_USD` on subsequent runs.
  Lowering below `cumulativeUsd` simply refuses all further runs (correct).

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

| Key                      | Content                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind` / `schemaVersion` | `dg11-validation-run-v1` / `1`                                                                                                                                                |
| `target`                 | `{name, repository, commit}` — repository from the explicit per-target table, commit = the ratified pin, ASSERTED against the clone's real HEAD before spend                  |
| `run`                    | `{runId, startedAt, completedAt, executor}` — timestamps are strict ISO-8601 UTC                                                                                              |
| `model`                  | model id observed on the first upstream response; the literal `unobserved` when telemetry is empty (the validator rejects the sentinel on any run with calls)                 |
| `pricing`                | `{pricePerMillionPrompt, pricePerMillionCompletion, reverifyNote}` — both prices strictly positive (a zero-price run refuses)                                                 |
| `telemetry[]`            | per call: `{requestId, model, promptTokens, completionTokens, latencyMs, costUsd}`                                                                                            |
| `measured`               | `{calls, promptTokens, completionTokens, latencyMsTotal, estimatedCostUsd, measuredCostUsd}`                                                                                  |
| `ledger`                 | `{before:{cumulativeUsd,ceilingUsd,remainingUsd}, after:{...}}` — `after.remainingUsd` clamps to 0 (never negative); cumulative above the ceiling requires an overshoot event |
| `coverage`               | `{rows, coveredRows, proposals}` — harvested from the run dir's `artifacts/13.json` (stage-13 inventory) + `artifacts/04.json` (stage-4 proposalRun)                          |
| `outcome`                | `{exitCode, status, outcome, finalStage}` — honest whatever it is                                                                                                             |
| `events[]`               | `{type, at, detail}` rows: `refusal`, `accounting-gap` (forwarded calls missing telemetry — run invalid, headroom frozen to 0), `ceiling-overshoot` (+`overrunUsd`)           |
| `groundednessSpotCheck`  | `pending` until the owner completes it (above)                                                                                                                                |

Refusal records (`dg11-validation-refusal-v1`) carry
`{kind, schemaVersion, target, runId, at, reason
(budget-ceiling|credentials-missing|proxy-ceiling|redaction-finding|zero-price|
ledger-unreadable|ceiling-mismatch|commit-mismatch), detail,
estimateUsd?, cumulativeUsd?, ceilingUsd?, remainingUsd?,
upstreamCallsPlaced}` — `upstreamCallsPlaced: 0` on a budget refusal is the
G-4 proof.

The spend ledger (`dg11-spend-ledger-v1`) is canonical JSON, written
atomically (temp + rename, mode 0o640): `{schemaVersion, target,
repository?, commit?, ceilingUsd, cumulativeUsd, entries:[{runId, recordedAt,
measuredCostUsd, calls, valid, accountingGap?}]}`. The validator enforces
`cumulativeUsd == Σ entries[].measuredCostUsd`, cross-checks each entry
against its run record, and requires EVERY run record to have an entry in
its target's ledger (an unaccounted record fails validation). An entry with
`accountingGap: true` freezes the ledger's remaining headroom to $0 until
manual repair.

## Deterministic proofs living in CI (no credentials, no spend)

`packages/intent-proposal-spike/src/__tests__/real-model.test.ts` proves,
on every CI run: budget preflight refusal with zero upstream hits (stub
upstream hit-counter), cumulative-ceiling refusal, mid-run proxy hard-refusal
at the ceiling (HTTP 402 `ARXIC-DG11-SPEND-CEILING`), credential-missing
fail-closed (SP-1), planted-canary redaction fail-closed with nothing
unsanitized written (SP-3/G-5), the validator accept/reject matrix including
the planted-secret negative control (G-1/G-5), ledger arithmetic coherence,
and the attestation well-known shape verified through the PRODUCTION
`verifyAttestation` policy path. The dual-review remediation round added:
zero-price preflight refusal + validator rejection, corrupt-ledger refusal
with byte-preserving fail-closed behavior and the unaccounted-record rule,
proxy stop-drain of in-flight forwards plus accounting-gap detection and
headroom freeze, honest ceiling-overshoot records (clamped remaining +
mandatory event), attestation-front origin pinning (absolute-form /
protocol-relative / backslash targets), recording-proxy inbound canary
authentication, ceiling env-vs-ledger agreement refusal, clone-HEAD pin
assertion, fail-closed `--live-key-env` (with `--allow-missing-live-key`),
response framing-header stripping (content-encoding/content-length), the
run-id guard, the `unobserved` model sentinel, and ISO-8601 timestamp
validation.
