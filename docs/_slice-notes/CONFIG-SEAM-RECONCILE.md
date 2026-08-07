# CONFIG-SEAM-RECONCILE — staged doc updates (charter §10.2)

Issue: #102 · PR: #(pending) · Disposition: mixed

> The type reconciliation itself is green (typecheck/lint/test all pass, real-world CLI proof unchanged) and would ordinarily be `verified`, but per ADR §2 an LLM may never assign `verified`. `mixed` because the reconciliation also **surfaced a genuine semantic divergence** between the CLI validator and the worker's policy layer; that divergence is reported (not papered over) and tracked in #104, deliberately out of scope here.

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

This slice is a follow-up reconcile, not a milestone tracker item, so no `## Open milestones` row changes. The relevant history rows are the M1-11 (#25) and M1-12 (#26) rows already in SYNC; their "PROVISIONAL … reconciles with the seam when #26 lands" wording is now satisfied and can be stale-swept by the integrator.

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-07 (8) | **#102 (CONFIG-SEAM-RECONCILE) CLI/worker config type reconciliation DONE.** The CLI's provisional `ParsedConfig` (`apps/cli/src/config/types.ts`, marked PROVISIONAL pending the #26 seam) is removed; the CLI now imports the worker seam's `ArxicConfig` (`apps/worker/src/run-spec.ts`) — one type, one owner. Owner = `@arxic/worker` seam (original PROVISIONAL intent; CLI → seam → `@arxic/contracts` dependency direction; `@arxic/contracts` is ruled out by the seam header's "MUST NOT be added to contracts — would require a new ADR"). The PROVISIONAL marker is deleted verbatim. The CLI's `RunExecutor` port and `LocalRunExecutor` are unchanged (type reconciliation, not a rewiring — no worker-backed executor; that is #103/M2). To unify to one type with zero validation-behaviour change, `ArxicConfig`'s policy/models literals were widened to the configurable surface the CLI validator actually accepts (`policy.mutation` → `leased-fixtures-only`\|`deny`\|`allow`, `policy.externalNetwork` → `deny`\|`allow`, `models.sourceRetention` → `disabled`\|`retained`, `policy.screenshots`/`trace` → `string`, `scope.featureFlags` + `fixtures.*` → optional); a sound validated-boundary `as ArxicConfig` cast was added in `validate.ts` (membership is runtime-checked just above it). This does NOT weaken security: the worker's safe-subset is enforced at runtime by `validateWorkerSecurity` (`!==` checks) and `freezePolicy` (which ignores these fields and hard-codes `externalNetwork: 'deny'` / `mutation: 'leased-fixtures-only'` regardless of input). Real-world proof: the existing `apps/cli/src/__tests__/real-world.test.ts` (real `runCli` against the real `reference-auth-app` with real Chromium/Crawlee + real sg/Tree-sitter) stayed green unchanged; validation sad paths in `config.test.ts` unchanged. **SEMANTIC DIVERGENCE SURFACED (tracked as #104, out of scope here):** the CLI validator accepts `mutation: 'allow'` / `externalNetwork: 'allow'` / `sourceRetention: 'retained'`, but the worker's `validateWorkerSecurity` rejects `mutation`/`externalNetwork` with `ARXIC-WORKER-CONFIG-UNSAFE`; in the current local-executor flow that check is never invoked, so such configs run locally unguarded. **M1 14/15 (unchanged).** Next: #104 decision + #103 (worker-backed executor, M2) + #27 M1-EXIT. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### internal`

```
- CONFIG-SEAM-RECONCILE CLI/worker config type reconciliation (#102): the CLI's provisional `ParsedConfig` is removed and the CLI imports the worker seam's `ArxicConfig` (`apps/worker/src/run-spec.ts`) — one type, one owner (`@arxic/worker`, per the original PROVISIONAL intent and the CLI → seam → `@arxic/contracts` dependency direction; `@arxic/contracts` ruled out without a new ADR). The `RunExecutor` port and `LocalRunExecutor` are unchanged (type reconciliation, not a rewiring). `ArxicConfig`'s policy/models literals are widened to the configurable surface the CLI validator accepts and bridged with a validated-boundary cast; config validation behaviour is unchanged (all `ARXIC-CONFIG-*` fail-closed paths hold, proved by the existing tests). The worker's safe-subset stays enforced at runtime by `validateWorkerSecurity`/`freezePolicy` (which hard-codes the safe literals). Surfaced and tracked as #104: the CLI validator accepts `mutation: 'allow'` / `externalNetwork: 'allow'` that the worker rejects — unguarded in the local flow today, to be resolved in #104/#103. Real-world proof: the existing real `runCli` test against `reference-auth-app` (real Chromium/Crawlee + sg/Tree-sitter) stayed green.
```

## 4. VERSION bump required?

no — purely an internal type-ownership reconciliation; no user-observable behaviour change (CLI accepted config shape, diagnostics, and exit codes are identical). `VERSION` remains 0.0.0 and equals `package.json`.

## 5. Evidence pointers

- Real-world proof: `apps/cli/src/__tests__/real-world.test.ts` — real `runCli(['run','--config',…])` driving the full pipeline against the real `reference-auth-app` (real Chromium via Crawlee, real sg/Tree-sitter, real Next.js target on an ephemeral port). The type-only reconciliation left this unchanged and green: observable run directory written, `outcome ∈ {observed, blocked}`, never `verified`.
- Seam-type proof: `apps/worker/src/run-spec.test.ts` — the ADR §19 example still `satisfies ArxicConfig` after the literal widening (widening is backward-compatible).
- Artifacts: none new (no UI); the run directory written by the real-world test is the artifact.
- Gates: typecheck ☑ · lint ☑ · format ☑ (run after this note) · test (515 passing) ☑ · license gate ☑ (`scripts/license-gate.test.mjs`, 21 tests, 0 rejected).

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                 | Expected disposition                                          | Test                                        |
| --------------------------------------- | ------------------------------------------------------------- | ------------------------------------------- |
| Missing config file                     | blocked — exit 2 `ARXIC-CONFIG-MISSING`                       | `apps/cli/src/__tests__/config.test.ts`     |
| Malformed YAML                          | blocked — exit 2 `ARXIC-CONFIG-PARSE`                         | `apps/cli/src/__tests__/config.test.ts`     |
| Missing `models`                        | blocked — exit 2 `ARXIC-CONFIG-MODEL-MISSING`                 | `apps/cli/src/__tests__/config.test.ts`     |
| `version !== 1`                         | blocked — `ARXIC-CONFIG-VERSION`                              | `apps/cli/src/__tests__/config.test.ts`     |
| `environmentClass: production`          | blocked — exit 2 `ARXIC-CONFIG-INVALID`                       | `apps/cli/src/__tests__/config.test.ts`     |
| `origin` not in `allowedOrigins`        | blocked — exit 2 `ARXIC-CONFIG-INVALID`                       | `apps/cli/src/__tests__/config.test.ts`     |
| URL userinfo in origin / allowedOrigins | blocked — exit 2 `ARXIC-CONFIG-INVALID`                       | `apps/cli/src/__tests__/config.test.ts`     |
| Unknown top-level key                   | blocked — `ARXIC-CONFIG-INVALID`                              | `apps/cli/src/__tests__/config.test.ts`     |
| Unreachable target                      | blocked — run directory still written, exit 1, no stack trace | `apps/cli/src/__tests__/real-world.test.ts` |

All sad paths are proved by **existing** tests (unchanged), per the issue's "proved by the existing tests rather than by rewritten ones".
