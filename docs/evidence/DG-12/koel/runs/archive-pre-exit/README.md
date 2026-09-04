# archive-pre-exit — koel pre-exit campaign history (retained, never deleted)

Every recorded koel campaign attempt BEFORE the exit gate pair (runs 24 + 25)
is retained here, moved out of `runs/` so the gate's evidence loader measures
exactly the two clean runs required by the frozen #256 contract (C-2: two clean
runs per app). Nothing was deleted or edited; per-run evidence, environ proofs,
and records are intact under their original names. The full decision trail
lives on #256; the ledger (`../spend-ledger.json`) still accounts every one of
these runs.

| run | outcome | recorded cause (distinct, remediated) |
| --- | --- | --- |
| run1–run3 | blocked stage-4 | 30s default model timeout (fixed by #345, `ARXIC_MODEL_TIMEOUT_MS`); archived by the earlier lane per the dg12-lib loadAppRuns contract |
| run4–run6 | blocked | pre-exit lane: form-surface + proposal-surface defects (#350 trail) |
| run7 | blocked stage-8 | semantic-ambiguous locators (#352; fixed by #353/#354) |
| run8 | blocked stage-10 | widget origin `app.lemonsqueezy.com` outside allow-list (ratified after measurement; #356 trail) |
| run9 | blocked stage-10 | `assets.lemonsqueezy.com` origin denial (amendment 5492405255) |
| run10 | blocked stage-10 | replay persona login discarded storage state (#362; fixed by #363) |
| run11 | blocked stage-10 | gravatar origin denial (amendment 5493582849) + unconditional storage injection contradicted login-including candidates (#364; fixed by #365) |
| run12–run13 | refusal (credentials-missing) | operator key absent at launch (refusal records in `../refusals/`) |
| run14–run15 | blocked stage-10 | anonymous login-form cardinality 0 — empty accessible-name submit (root-caused live; fixed by #383/PR #385) |
| run16 | blocked stage-4 | pay-as-you-go endpoint HTTP 429 (base URL corrected to the coding-plan endpoint) |
| run17 | blocked stage-4 | adapter timeout at 240s on glm-5.3 reasoning (raised via env) |
| run18 | blocked stage-4 | recording-proxy hardcoded 120s upstream abort → accounting gap (fixed by #389, `ARXIC_DG11_UPSTREAM_TIMEOUT_MS`; issue #390) |
| run19 | blocked stage-4 | #337 price-gate refusal: template provider `openai/gpt-4o-mini` (amendment 3: provider `glm-5.3`) |
| run20 | no record | operator-session interruption killed the launcher tree mid-stage-4; partial dir retained; spend bounded by the preflight estimate (see #256 comment) |
| run21 | blocked stage-12 | template missing the 3 ratified origins (fail-correct #357 enforcement over an incomplete config; origins folded with disclosure) — stage-5/8 evidence cited at #350/#352 closures |
| run22 | blocked stage-4 | transient upstream provider-error burst; accounting gap reconciled (zero-cost gap calls) |
| run23 | refusal (budget-ceiling preflight) | headroom still frozen at launch (ledger repair completed after); refusal record in `../refusals/` |

The exit gate pair — `koel-dg12-hostbound-run24` + `koel-dg12-hostbound-run25` —
both completed `verified` with promotion (see `../promoted/`).
