# CORRECTION NOTE — #337: DG-12 spend ledger priced glm-5.3 at gpt-4o-mini rates

**Status:** additive correction record. **Nothing under `docs/evidence/DG-12/**/runs/**` or in
`spend-ledger.json` is edited by this note or by #337** — the historical run records and ledger
entries stay exactly as they were written, per the DG-12 evidence-integrity rule (ADR §2: an LLM
may never assign `verified`, and a recorded observation is not silently rewritten).

At the time this note was authored, `docs/evidence/DG-12/directus/runs/directus-dg12-run{21,22,23}.json`
and the corresponding `spend-ledger.json` entries were still staged in the `#324` lane's working
worktree and had not yet landed on `main` (see #324 comment history, 2026-08-27). This note is
written in advance so the correction travels with the campaign regardless of which PR lands the
run records first; once they land, the paths below resolve as named.

## The defect

`docs/evidence/DG-12/directus/runs/directus-dg12-run21.json`, `run22.json`, and `run23.json` each
declare:

```json
"pricing": {
  "pricePerMillionPrompt": 0.15,
  "pricePerMillionCompletion": 0.6,
  "reverifyNote": "list prices declared by the operator for this run; the owner re-verifies prices at read time (owner decision 2)"
}
```

`0.15` / `0.60` per 1,000,000 tokens is **gpt-4o-mini's** list price (the DG-04 measurement
default). The model actually invoked for these three runs was **`glm-5.3`** on z.ai
(`"model": "glm-5.3"` in the same run records). z.ai's own list price for glm-5.3 is
**$1.40 prompt / $4.40 completion per 1,000,000 tokens**
(<https://docs.z.ai/guides/overview/pricing>, verified live 2026-08-27). Every recorded
`measured.measuredCostUsd` for these three runs, and the `cumulativeUsd` running total in
`docs/evidence/DG-12/directus/spend-ledger.json`, is therefore priced at the wrong model's rate —
understated by a factor of ~7.4x.

The token counts, request ids, and latencies in `telemetry[]` are real and provider-reported; only
the price constants applied to them are wrong for this model. This is an accounting-record defect,
not a runner or fabrication defect.

## Recomputed figures (arithmetic, not a record edit)

| Run     | prompt tokens | completion tokens | recorded `measuredCostUsd` (@ 0.15/0.60, gpt-4o-mini rate — WRONG for this model) | recomputed @ z.ai list price ($1.40/$4.40) |
| ------- | ------------: | ----------------: | --------------------------------------------------------------------------------: | -----------------------------------------: |
| run21   |           699 |             5,638 |                                                                        0.00348765 |                                  0.0257858 |
| run22   |           946 |             8,210 |                                                                        0.00506790 |                                  0.0374484 |
| run23   |         1,018 |             6,724 |                                                                        0.00418710 |                                  0.0310108 |
| **sum** |               |                   |                                                                    **0.01274265** |                              **0.0942450** |

```
run21: 699*1.40e-6 + 5638*4.40e-6  = 0.0257858
run22: 946*1.40e-6 + 8210*4.40e-6  = 0.0374484
run23: 1018*1.40e-6 + 6724*4.40e-6 = 0.0310108
```

Understatement factor: `0.0942450 / 0.01274265 ≈ 7.396x`, matching the recorded-figure reproduction
in #337 (recomputing each run's own recorded `measuredCostUsd` at 0.15/0.60 against its own recorded
token counts reproduces the recorded number to the last digit — the proof that the gpt-4o-mini
constants, not the token counts, are what's wrong).

## Open question this note does NOT resolve (owner decision, per #337 and #324)

The DG-12 campaign ran on a **z.ai coding plan**, which may be subscription-priced with zero
marginal per-token cost. If so, the true marginal spend for these three runs is $0.00 and *neither*
the recorded figure nor the $1.40/$4.40 recompute above is the "true" cost — that determination is
an owner pre-measurement decision (ADR-008 convention), not a mechanical fix, and is explicitly out
of scope for this correction note.

## What this note asserts and does not assert

- Asserts: the price _constants_ applied to runs 21-23 belong to gpt-4o-mini, not glm-5.3, and the
  z.ai list-price recompute above is arithmetically correct from the runs' own recorded token
  counts.
- Does NOT assert: that $1.40/$4.40 is the operative "true cost" figure for a coding-plan campaign
  (see open question above), and does NOT alter `valid`, `measuredCostUsd`, `cumulativeUsd`, or any
  other field on the historical run/ledger records.
- Does NOT retroactively re-check the run21-23 campaign against the `$1.00` hard ceiling; if the
  z.ai list-price interpretation is adopted, the ceiling check for that campaign should be
  re-evaluated by the owner using the recomputed cumulative total above.

## Root-cause fix (code, not evidence)

Refs #337. `packages/orchestrator-langgraph/src/intent-proposer.ts` (`MODEL_PRICE_TABLE`,
`resolveModelPrices`, `resolveModelPricesOrDefault`) now keys the pre-call budget-estimate price to
the model actually configured instead of unconditionally defaulting to gpt-4o-mini's rate, and adds
a fail-closed `resolveModelPrices` for callers that want a hard guarantee against an unrecognized
model id being silently mispriced. See that PR for the full explanation of what is, and is not,
wired to fail closed by default, and why.

The actual generator that wrote the wrong `pricing` block into runs 21-23 —
`packages/intent-proposal-spike/scripts/dg11-run-validation.ts` (confirmed by the #324 2026-08-27
STATUS comment: "Run20 also declares stale 0.15/0.60 prices") — is **not** touched by this note or
by #337; that script is in the `#333` lane's exclusive territory per this slice's coordination
instructions and is out of scope here.
