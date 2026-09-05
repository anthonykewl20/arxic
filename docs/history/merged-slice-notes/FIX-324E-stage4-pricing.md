# FIX-324E-stage4-pricing — staged doc updates (charter §10.2)

Issue: #324 · PR: pending · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #324 | [FIX-324E-stage4-pricing] Real CLI test model configurations name a priced model identifier, preserving fail-closed pricing | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-29 | **#324 (FIX-324E-stage4-pricing) real CLI pricing regression corrected.** The local, endpoint-less replay, and worker-Docker CLI configurations had passed the transport sentinel `configured-adapter` as the model identifier. Stage 4 correctly resolves its pre-call price from the identifier it sends to the adapter, so #337 correctly refused that unpriced sentinel. Each fixture now sends and reports `gpt-4o-mini`, the cited priced model in `MODEL_PRICE_TABLE`; all three journeys reach their original verification or stage-7 refusal assertions. Independent worker-Docker reproduction confirmed the same stage-4 cause, not Docker network churn. Fail-closed handling for unknown production model identifiers remains unchanged. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-324E stage-4 pricing (#324): local, third-party replay, and worker-Docker CLI regression configurations now identify and report the priced `gpt-4o-mini` model they send through the OpenAI-compatible adapter, so stage 4 retains #337's fail-closed unknown-model pricing guard while the real journeys execute their intended assertions.
```

## 4. `VERSION` bump required?

no — this corrects only in-repository real-world test configuration; the public configuration schema, runtime pricing table, and production behavior are unchanged.

## 5. Evidence pointers

- Root cause: `apps/cli/src/local-executor.ts` and `apps/worker/src/main.ts` pass `config.models.provider` as the adapter request model and as `OrchestratorOptions.model`; `packages/orchestrator-langgraph/src/orchestrator.ts` resolves that exact value through `resolveModelPrices` before stage 4. The tests configured the sentinel `configured-adapter`, which is intentionally absent from the price table. An independent real-Docker worker reproduction observed the same block, excluding Docker network churn as its cause.
- Real-world proof: `apps/cli/src/__tests__/real-world.test.ts` — 3 tests passed against the real reference-auth-app, real Mailpit, real Chromium, and a local OpenAI-compatible boundary stub.
- Real-world proof: `apps/cli/src/__tests__/third-party-replay-e2e.real-world.test.ts` — 2 tests passed against the real endpoint-less reference-auth-app proxy, real Mailpit, and real Chromium; includes its stage-7 `ARXIC-VERIFY-FIXTURE-NOT-DECLARED` assertion.
- Regression-adjacent proof: `apps/cli/src/__tests__/third-party-replay.real-world.test.ts` — 3 tests passed over the third-party replay declaration/refusal behaviors.
- Real-world proof: `apps/cli/src/__tests__/worker-real-world.test.ts` — 2 tests passed against the real `arxic-worker:dev` Docker image, internal Docker network, and vulnerable-auth-app; the verified sandbox journey completed beyond stage 4.
- Gates: `pnpm typecheck` passed · `pnpm lint` passed · `pnpm format:check` passed · targeted tests 10 passing.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                  | Expected disposition                                                                                         | Test                                                                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Unpriced transport sentinel reaches `resolveModelPrices` | `blocked` before stage 4 can call the model; no silent reuse of another model's rates                        | Red reproduction: `apps/cli/src/__tests__/real-world.test.ts` failed at stage 4 with `ARXIC-ORCH-STAGE-BLOCKED` and the #337 message |
| Endpoint-less target has no replay-persona declaration   | `blocked` at stage 7 with frozen `ARXIC-VERIFY-FIXTURE-NOT-DECLARED`, rather than failing earlier at pricing | `apps/cli/src/__tests__/third-party-replay-e2e.real-world.test.ts`                                                                   |
| Unreachable worker target                                | `blocked` without promotion; it must not be masked by a pricing failure                                      | `apps/cli/src/__tests__/worker-real-world.test.ts`                                                                                   |
