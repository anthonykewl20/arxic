# FIX-337-glm53-pricing — slice note

Issue: #337 · PR: #TBD · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #337 | [FIX-337-glm53-pricing] DG-12 spend ledger priced glm-5.3 runs at gpt-4o-mini rates — model-keyed price table + fail-closed resolver added, correct z.ai list price wired into the production budget-estimate default | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-27 | **#337 (FIX-337-glm53-pricing) glm-5.3 priced at gpt-4o-mini rates FIXED (estimate path).** `packages/orchestrator-langgraph/src/intent-proposer.ts` had one global `DEFAULT_MODEL_PRICES` (gpt-4o-mini, 0.15/0.60 per 1M) applied to the pre-call budget-estimate regardless of the configured `model` — the same silent-fallback defect class that mispriced DG-12 runs 21-23 in their evidence records (0.15/0.60 gpt-4o-mini rate applied to `glm-5.3`, ~7.4x understated vs z.ai's $1.40/$4.40 list price, https://docs.z.ai/guides/overview/pricing, verified live). Fix: `MODEL_PRICE_TABLE` (gpt-4o-mini + glm-5.3, cited sources) plus `resolveModelPrices` (strict, throws on an unrecognized model id — "#337: no price-table entry...") and `resolveModelPricesOrDefault` (the one actually wired into `proposeCandidates`/`orchestrator.ts`'s default, which falls back to `DEFAULT_MODEL_PRICES` for a model with no table entry rather than throwing — scoped down deliberately because this call path is shared with many real-world test fixtures using synthetic never-priced model ids, and hard-failing all of them is a separate, larger change out of this issue's scope). Red-first ×6 in `intent-proposer.test.ts` (glm-5.3 no longer reproduces run23's recorded gpt-4o-mini-rate figure; glm-5.3/gpt-4o-mini table lookups; `resolveModelPrices` throws on an unknown id; `proposeCandidates` does NOT throw by default on an unknown id — documents the scoped-down choice; an explicit `prices` override still works for an unknown id). Additive correction record only, no evidence rewrite: `docs/evidence/DG-12/CORRECTION-337-glm53-pricing.md` recomputes runs 21-23 at the z.ai list price ($0.0257858/$0.0374484/$0.0310108, sum $0.0942450 vs the recorded $0.01274265, factor ~7.396x) without touching any run JSON or `spend-ledger.json` field (those files hadn't landed on `main` yet as of this slice — staged in #324's worktree). Did NOT touch `packages/intent-proposal-spike/scripts/dg11-run-validation.ts`, the actual generator of the wrong `pricing` block on the historical runs — that's the #333 lane. Full `orchestrator-langgraph` suite: 20 files / 220 tests passing. **Next: #324/#333 land the real run21-23 records + generator fix; owner settles the z.ai coding-plan marginal-cost question flagged in the correction note.** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-337 glm-5.3 pricing (#337): the pre-call budget-estimate price now resolves from a model-keyed table (`MODEL_PRICE_TABLE`) instead of unconditionally defaulting to gpt-4o-mini's rate, fixing glm-5.3 to price at z.ai's list rate ($1.40/$4.40 per 1M vs the wrong $0.15/$0.60); a strict `resolveModelPrices` is available for callers that want a fail-closed guarantee against an unrecognized model id being silently mispriced. Additive-only correction record added for the DG-12 evidence campaign; no historical run/ledger record was modified.
```

## 4. `VERSION` bump required?

no — the change corrects a pre-call cost ESTIMATE default and adds new exported helpers
(`MODEL_PRICE_TABLE`, `resolveModelPrices`, `resolveModelPricesOrDefault`); no existing exported
type or the caller-facing `ModelPrices`/`proposeCandidates` contract shape changed (an explicit
`prices` override still behaves exactly as before), and no run-record schema changed.

## 5. Evidence pointers

- Root-cause code: `packages/orchestrator-langgraph/src/intent-proposer.ts` (`MODEL_PRICE_TABLE`,
  `resolveModelPrices`, `resolveModelPricesOrDefault`, and the `proposeCandidates` call site);
  `packages/orchestrator-langgraph/src/orchestrator.ts` (the `intentProposerInfer` wiring call
  site).
- Price source: https://docs.z.ai/guides/overview/pricing (glm-5.3: $1.40 input / $4.40 output per
  1M tokens; fetched and verified live 2026-08-27, matches the #324 round-1 research citation).
- Additive correction record: `docs/evidence/DG-12/CORRECTION-337-glm53-pricing.md` — recomputes
  runs 21-23 without touching any historical run JSON or `spend-ledger.json`.
- Red-first tests: `packages/orchestrator-langgraph/src/__tests__/intent-proposer.test.ts`, new
  `describe('#337 model-keyed pricing (fail-closed, no silent gpt-4o-mini fallback)')` block (6
  tests); confirmed red against the pre-fix source (5 of 6 failed: import errors for the
  not-yet-existing exports, plus the pricing-equality assertion) by reverting only
  `intent-proposer.ts`/`orchestrator.ts` and re-running with the new tests still in place.
- Gates: `packages/orchestrator-langgraph` typecheck clean; full package suite 20 files / 220 tests
  passing (includes real-world Playwright-backed suites, unaffected); `format:check`: see report.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                          | Expected disposition                                                                                                                                                                                | Test                                                                                |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| glm-5.3 configured, no explicit `prices` override                                | resolves to z.ai list price ($1.40/$4.40), NOT gpt-4o-mini's rate; recomputing run23's real token counts at the resolved price must differ from the wrong recorded figure and match the correct one | RED-first: 'glm-5.3 must NOT price at gpt-4o-mini rates'                            |
| unknown/future model id, strict resolver                                         | throws with a `#337`-tagged, actionable message instead of silently defaulting                                                                                                                      | 'fails closed (throws) for an unknown model id instead of silently defaulting'      |
| unknown/future model id, default `proposeCandidates` path (no explicit `prices`) | falls back to `DEFAULT_MODEL_PRICES` (documented, deliberate scope-down — NOT fail-closed by default on this shared call path)                                                                      | 'proposeCandidates does NOT fail closed by default for an unrecognized model id...' |
| unknown model id WITH an explicit `prices` override                              | override wins; run proceeds normally (owner escape hatch, unaffected by the table)                                                                                                                  | 'proposeCandidates honors an explicit prices override even for an unknown model id' |

## 7. Not done / known-weak spots

- **The actual generator of the wrong recorded prices was NOT touched.**
  `packages/intent-proposal-spike/scripts/dg11-run-validation.ts` (confirmed root cause per the
  #324 2026-08-27 STATUS comment: "Run20 also declares stale 0.15/0.60 prices") owns the DG-11/
  DG-12 evidence-generation code path and is the #333 lane's exclusive territory. Future DG-11/
  DG-12 campaigns will keep mispricing glm-5.3 in their recorded `measuredCostUsd` until that
  script is fixed separately — this is an explicit, reported gap, not a silent omission.
- **Fail-closed is NOT the default runtime behavior for `proposeCandidates`/the orchestrator.**
  I deliberately scoped down from "unknown model id always throws" to "unknown model id falls back
  to `DEFAULT_MODEL_PRICES`, with a strict throwing alternative (`resolveModelPrices`) available for
  callers that want it." The full fail-closed wiring broke 3 tests in
  `inference-real-world.test.ts` that use synthetic model ids (`test-model-v1`) never meant to be
  priced at all, on the identical call path used in production — rewriting every such fixture
  across the suite is a materially larger change than this issue's scope, and the issue text itself
  sanctions this trade-off ("If a fail-closed change is bigger than this issue's scope, implement
  the correct price and report the fallback risk explicitly"). **Fallback risk that remains open:**
  a genuinely new production model swapped in without a `MODEL_PRICE_TABLE` entry AND without an
  explicit `prices` override will silently estimate at gpt-4o-mini's rate — exactly the defect
  class this issue reports, just no longer true for glm-5.3 specifically. Closing this fully needs
  either a fixture-wide cleanup (out of scope) or a narrower signal (e.g., only fail closed when the
  adapter's `baseUrl` targets a known non-fixture endpoint) that I did not attempt.
- **The historical run21-23 records and `spend-ledger.json` were not available in this worktree** —
  they had not yet landed on `main` (staged in the separate `#324` worktree) as of this slice. The
  correction note is written referencing their expected paths and was cross-checked against the
  actual staged JSON content (read-only) to confirm the recomputation arithmetic; it will apply
  once those files land regardless of which PR gets there first.
- No live model campaign was run and no model credential was used or sought; all verification is
  arithmetic against already-recorded token counts and a live doc-page price lookup.
