# FIX-324C — staged doc updates (charter §10.2)

Issue: #324 · PR: #TBD · Disposition: mixed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #324 | [FIX-324C] Stage-4 blocked on schema-blind provider; grounded-ratio remeasurement | ☐ open (AC-1/AC-2 met; AC-3 blocked on design; AC-4 blocked on operator credential) |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-27 | **#324 (FIX-324C) stage-4 root cause PROVEN and fixed; AC-4 NOT measured.** The DG-12 campaigns (directus run21-23) blocked at stage 4 because z.ai/glm-5.3 silently ignores `response_format.type=json_schema` — proven from retained artifacts alone: `intent-proposer.ts` pins `schemaVersion` as a single-member enum, `client.ts` sends it with `strict:true`, yet run22 drifted that enum on all four calls, which honoured constrained decoding makes impossible. `buildProposalMessages` carried no schema in the prompt, so the model invented the shape; run23 confirmed it by moving exactly one step down to AJV after the version literal was pinned in prose. Fix: state the literal wire schema in a trusted system message, `response_format` unchanged, AJV and the version check unchanged (nothing relaxed). Also retained the previously-discarded AJV failure detail on `ARXIC-MODEL-RETRIES-EXHAUSTED` through the existing fail-closed `redactionGate`. **AC-2 was already satisfied on `main`** — `koel-dg12-run23/artifacts/13.json` shows 304 extracted / 7 unextracted-with-reason / 4 unsupported with ZERO mislabelled diagnostic, parse-error or language-placeholder rows; denominator unchanged at 315. **AC-3 is blocked on a design decision** (below). **AC-4 was not attempted**: no model credential exists in this environment, so no campaign ran and no spend was incurred. Next: #324 AC-3 design + operator-credentialed remeasurement. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-324C schema-blind structured output (#324): the intent-proposal prompt now states the literal wire schema in a trusted system message, so providers that ignore `response_format.type=json_schema` (measured: z.ai glm-5.3) can still produce a conforming payload; `response_format` and the local AJV + schema-version checks are unchanged, so nothing is relaxed for any caller. `ARXIC-MODEL-RETRIES-EXHAUSTED` now carries the length-bounded AJV failure detail (through the existing fail-closed redaction gate) instead of a generic message, so a shape mismatch is diagnosable without retaining raw provider content. `ARXIC_MODEL_TIMEOUT_MS` plumbs a positive-integer request timeout from the CLI to `ModelAdapter`, defaulting to 30000 ms and refusing invalid present values before provider access.
```

## 4. `VERSION` bump required?

no — the change is internal to inference plumbing and diagnostics; no user-observable CLI or bundle surface changes.

## 5. Evidence pointers

- Root-cause proof (retained artifacts, no new spend): `docs/evidence/DG-12/directus/runs/directus-dg12-run22/diagnostics.jsonl:2695` (`ARXIC-MODEL-SCHEMA-VERSION-DRIFT` against the single-member enum at `packages/orchestrator-langgraph/src/intent-proposer.ts:163`, sent with `strict:true` at `packages/model-adapter/src/client.ts:99-106`) and `docs/evidence/DG-12/directus/runs/directus-dg12-run23/diagnostics.jsonl:2695` (`ARXIC-MODEL-RETRIES-EXHAUSTED` after the prose pin landed).
- Real-world proof: `packages/model-adapter/src/__tests__/sad-paths.test.ts` — the unmodified `ModelAdapter` against a REAL local OpenAI-compatible HTTP endpoint (`__tests__/stub.ts`, `node:http`), reproducing the run23 signature (correct `schemaVersion`, wrong shape below it) and asserting the retained AJV detail.
- Real-world proof: `packages/orchestrator-langgraph/src/__tests__/intent-proposer.test.ts` — the proposer against the same real local endpoint; the new cases assert the literal schema reaches the prompt on first and retry attempts and stays in the trusted system role, never inside the untrusted `INVENTORY_DATA` block.
- Artifacts: no new run directory — no campaign was executed (no credential). Cumulative ledger spend unchanged at $0.18277015 of the $1.00 ceiling.
- Gates: typecheck ☑ · lint ☑ · format ☑ · test ☑ · license gate ☑ (see the PR's CI run)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                          | Expected disposition                                                                                                   | Test                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider ignores `json_schema`; model returns correct `schemaVersion` but a wrong shape below it | `blocked` — `ARXIC-MODEL-RETRIES-EXHAUSTED` after bounded retries, now NAMING the failing instance path and constraint | `packages/model-adapter/src/__tests__/sad-paths.test.ts` — "retains the AJV failure detail on the exhausted-retries diagnostic"                                   |
| Model returns a drifted `schemaVersion`                                                          | `blocked` — `ARXIC-MODEL-SCHEMA-VERSION-DRIFT`, unchanged and still fail-closed                                        | `packages/model-adapter/src/__tests__/sad-paths.test.ts` — "schema-version drift retries then fails closed"                                                       |
| Model returns unparseable content                                                                | `blocked` — `ARXIC-MODEL-RETRIES-EXHAUSTED`, unchanged                                                                 | `packages/model-adapter/src/__tests__/sad-paths.test.ts` — "malformed output is retried then blocked"                                                             |
| Schema block leaks into the untrusted data block (prompt-injection surface)                      | `contradicted` — the schema must appear only in `system` role messages                                                 | `packages/orchestrator-langgraph/src/__tests__/intent-proposer.test.ts` — "keeps the schema block inside the trusted system role, never the untrusted data block" |
| Retry attempt drops the schema from the prompt                                                   | `contradicted` — every attempt (1, 2, 3) must carry the literal schema                                                 | `packages/orchestrator-langgraph/src/__tests__/intent-proposer.test.ts` — "carries the literal wire schema in the prompt on first and retry attempts"             |
| `ARXIC_MODEL_TIMEOUT_MS` present but blank / non-positive / non-integer                          | `blocked` — refused before any provider access                                                                         | `apps/cli/src/__tests__/local-executor.test.ts`                                                                                                                   |

## 7. NOT done in this slice (read this before claiming #324 complete)

- **AC-4 (>=80% grounded ratio on koel AND directus): NOT MEASURED.** No `ARXIC_MODEL_API_KEY` / `ARXIC_MODEL_BASE_URL` exists in this environment (checked the process env and the documented locations at `docs/evidence/DG-12/DESIGN.md:407,460`). No campaign was started, so there is no new run directory, no ratio, and no verdict. The threshold was NOT retuned. Per ADR-008 only the OWNER may retune it, before re-measurement, and it must be recorded.
- **AC-3 (Cause C, crawl-form availability signal): NOT IMPLEMENTED — blocked on a design decision.** Two independent obstacles were confirmed: (1) _timing_ — stage 4 proposes from the SOURCE inventory (`packages/orchestrator-langgraph/src/orchestrator.ts:830` calls `toProposalConsumerInventory` on the stage-13 envelope built at `:665`), while runtime forms only land at `fuseRuntimeInventory` in stage 6 (`orchestrator.ts:1006`), so `observedForms` is necessarily `[]` at proposal time; (2) _shape_ — `ProposalConsumerRow` is a type-only alias of `InventoryRow` in the FROZEN `@arxic/intent-proposal-spike` package (`packages/domain-inventory-spike/src/consumer-adapter.ts:47`), held in lockstep by an `Equal<>` type assertion, so no form field can be added to the projection without either editing frozen spike evidence or breaking that lockstep. Resolving this needs an owner decision on how the consumer projection may be extended; it was deliberately not self-approved.
- **The approved temporary raw-content diagnostic probe was NOT added.** It proved unnecessary: the retained run22/run23 diagnostics already discriminate the candidate causes (see §5), and the AJV-detail retention gives the same information permanently, sanitized, at zero spend. No raw provider content was captured or written anywhere.
- **A separate accounting defect is reported but NOT repaired here.** `docs/evidence/DG-12/directus/runs/directus-dg12-run23.json` declares `pricing` 0.15 / 0.60 per 1M — gpt-4o-mini list price — while `model` is `glm-5.3`. The recorded `measuredCostUsd` 0.0041871 reproduces exactly at 0.15/0.60 and would be 0.0310108 at the z.ai list price recorded earlier in #324 ($1.40 / $4.40). Runs 21-23 are therefore priced ~7.4x low against list. Repairing a ledger is an owner action; it is recorded on #324 for decision.
