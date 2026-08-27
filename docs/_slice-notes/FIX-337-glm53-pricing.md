# FIX-337-glm53-pricing — slice note

Issue: #337 · PR: #338 · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #337 | [FIX-337-glm53-pricing] DG-12 spend ledger priced glm-5.3 runs at gpt-4o-mini rates — model-keyed price table wired into the production budget-estimate default, unknown model ids now FAIL CLOSED | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-27 | **#337 (FIX-337-glm53-pricing) glm-5.3 priced at gpt-4o-mini rates FIXED, unknown-model fail-closed (estimate path).** `packages/orchestrator-langgraph/src/intent-proposer.ts` had one global `DEFAULT_MODEL_PRICES` (gpt-4o-mini, 0.15/0.60 per 1M) applied to the pre-call budget-estimate regardless of the configured `model` — the same silent-fallback defect class that mispriced DG-12 runs 21-23 in their evidence records (0.15/0.60 gpt-4o-mini rate applied to `glm-5.3`, ~7.4x understated vs z.ai's $1.40/$4.40 list price, https://docs.z.ai/guides/overview/pricing, verified live). Fix: `MODEL_PRICE_TABLE` (gpt-4o-mini + glm-5.3, cited sources) plus `resolveModelPrices`, now wired as the DEFAULT at both call sites (`proposeCandidates` and `orchestrator.ts`'s `intentProposerInfer` wiring) — an unrecognized model id with no explicit `prices` override THROWS ("#337: no price-table entry for model...") instead of silently inheriting another model's rates; an explicit `prices` override still works as an owner escape hatch. Fixing this properly (not loosening any test) required giving the 3 `inference-real-world.test.ts` cases that exercise this call path with the synthetic fixture id `test-model-v1` an explicit `modelPrices` override, since that id has no real-world price and must not silently default. Red-first ×6 in `intent-proposer.test.ts` (glm-5.3 no longer reproduces run23's recorded gpt-4o-mini-rate figure; glm-5.3/gpt-4o-mini table lookups; `resolveModelPrices` throws on an unknown id; `proposeCandidates` fails closed by default on an unknown id with zero provider calls made; an explicit `prices` override still works for an unknown id). Additive correction record only, no evidence rewrite: `docs/evidence/DG-12/CORRECTION-337-glm53-pricing.md` recomputes runs 21-23 at the z.ai list price ($0.0257858/$0.0374484/$0.0310108, sum $0.0942450 vs the recorded $0.01274265, factor ~7.396x) without touching any run JSON or `spend-ledger.json` field (those files hadn't landed on `main` yet as of this slice — staged in #324's worktree). Did NOT touch `packages/intent-proposal-spike/scripts/dg11-run-validation.ts`, the actual generator of the wrong `pricing` block on the historical runs — that's the #333 lane. Full `orchestrator-langgraph` suite: 20 files / 220 tests passing. **Next: #324/#333 land the real run21-23 records + generator fix; owner settles the z.ai coding-plan marginal-cost question flagged in the correction note.** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-337 glm-5.3 pricing (#337): the pre-call budget-estimate price now resolves from a model-keyed table (`MODEL_PRICE_TABLE`) instead of unconditionally defaulting to gpt-4o-mini's rate, fixing glm-5.3 to price at z.ai's list rate ($1.40/$4.40 per 1M vs the wrong $0.15/$0.60); an unrecognized model id with no explicit `prices` override now FAILS CLOSED (throws) instead of silently inheriting another model's rates. Additive-only correction record added for the DG-12 evidence campaign; no historical run/ledger record was modified.
```

## 4. `VERSION` bump required?

no — the change corrects a pre-call cost ESTIMATE default and adds new exported helpers
(`MODEL_PRICE_TABLE`, `resolveModelPrices`); no existing exported type or the caller-facing
`ModelPrices`/`proposeCandidates` contract shape changed (an explicit `prices` override still
behaves exactly as before), and no run-record schema changed. The new throw is a behavior change
only for a caller that was previously relying on the silent gpt-4o-mini fallback for an
unrecognized model id and supplied no explicit override — which is precisely the defect being
fixed, not a compatibility break worth a version bump.

## 5. Evidence pointers

- Root-cause code: `packages/orchestrator-langgraph/src/intent-proposer.ts` (`MODEL_PRICE_TABLE`,
  `resolveModelPrices`, and the `proposeCandidates` call site);
  `packages/orchestrator-langgraph/src/orchestrator.ts` (the `intentProposerInfer` wiring call
  site) — both now call `resolveModelPrices` (strict) as the default when no explicit `prices`/
  `modelPrices` is supplied.
- Price source: https://docs.z.ai/guides/overview/pricing (glm-5.3: $1.40 input / $4.40 output per
  1M tokens; fetched and verified live 2026-08-27, matches the #324 round-1 research citation).
- Additive correction record: `docs/evidence/DG-12/CORRECTION-337-glm53-pricing.md` — recomputes
  runs 21-23 without touching any historical run JSON or `spend-ledger.json`.
- Red-first tests: `packages/orchestrator-langgraph/src/__tests__/intent-proposer.test.ts`, new
  `describe('#337 model-keyed pricing (fail-closed, no silent gpt-4o-mini fallback)')` block (6
  tests); confirmed red against the pre-fix source (5 of 6 failed: import errors for the
  not-yet-existing exports, plus the pricing-equality assertion) by reverting only
  `intent-proposer.ts`/`orchestrator.ts` and re-running with the new tests still in place.
- Fixture fix (not a test loosening): `packages/orchestrator-langgraph/src/__tests__/inference-real-world.test.ts`
  — the 3 `LangGraphOrchestrator` cases using the synthetic `test-model-v1` id now pass an explicit
  `modelPrices: { promptPerMillion: 0.15, completionPerMillion: 0.6 }` so they keep exercising their
  actual subject (retry/reconciliation/error-attribution behavior) rather than accidentally
  depending on the removed silent-default pricing behavior. No assertion was weakened.
- Gates: `packages/orchestrator-langgraph` typecheck clean; full package suite 20 files / 220 tests
  passing (includes real-world Playwright-backed suites); `format:check` and repo-wide `lint`: see
  report.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                          | Expected disposition                                                                                                                                                                                | Test                                                                                                            |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| glm-5.3 configured, no explicit `prices` override                                | resolves to z.ai list price ($1.40/$4.40), NOT gpt-4o-mini's rate; recomputing run23's real token counts at the resolved price must differ from the wrong recorded figure and match the correct one | RED-first: 'glm-5.3 must NOT price at gpt-4o-mini rates'                                                        |
| unknown/future model id, strict resolver, called directly                        | throws with a `#337`-tagged, actionable message instead of silently defaulting                                                                                                                      | 'fails closed (throws) for an unknown model id instead of silently defaulting'                                  |
| unknown/future model id, `proposeCandidates` default path (no explicit `prices`) | fails closed BEFORE any provider call (throws; zero HTTP requests sent)                                                                                                                             | 'proposeCandidates fails closed BEFORE any provider call when the configured model has no price-table entry...' |
| unknown model id WITH an explicit `prices` override                              | override wins; run proceeds normally (owner escape hatch, unaffected by the table)                                                                                                                  | 'proposeCandidates honors an explicit prices override even for an unknown model id'                             |

## 7. Not done / known-weak spots

- **The actual generator of the wrong recorded prices was NOT touched.**
  `packages/intent-proposal-spike/scripts/dg11-run-validation.ts` (confirmed root cause per the
  #324 2026-08-27 STATUS comment: "Run20 also declares stale 0.15/0.60 prices") owns the DG-11/
  DG-12 evidence-generation code path and is the #333 lane's exclusive territory. Future DG-11/
  DG-12 campaigns will keep mispricing glm-5.3 in their recorded `measuredCostUsd` until that
  script is fixed separately — this is an explicit, reported gap, not a silent omission. That
  script has its own separate, un-keyed price constants; this PR does not wire it to
  `MODEL_PRICE_TABLE`.
- **Any caller of `proposeCandidates`/the orchestrator's proposer path outside
  `orchestrator-langgraph`'s own test suite that relied on the previous silent gpt-4o-mini fallback
  for an unrecognized model id will now see a thrown error instead.** A repo-wide grep found no
  other package or app test exercising this exact call path (only `orchestrator-langgraph`'s own
  suites do), so the blast radius was fully covered by the 3 fixture fixes above — but this is
  worth flagging explicitly since it's the behavior change the fix is designed to cause.
- **The historical run21-23 records and `spend-ledger.json` were not available in this worktree** —
  they had not yet landed on `main` (staged in the separate `#324` worktree) as of this slice. The
  correction note is written referencing their expected paths and was cross-checked against the
  actual staged JSON content (read-only) to confirm the recomputation arithmetic; it will apply
  once those files land regardless of which PR gets there first.
- No live model campaign was run and no model credential was used or sought; all verification is
  arithmetic against already-recorded token counts and a live doc-page price lookup.
