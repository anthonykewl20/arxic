# FIX-324D — staged doc updates (charter §10.2)

Issue: #324 · PR: #TBD · Disposition: mixed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #324 | [FIX-324D] Post-crawl form-availability signal (AC-3, Cause C) | ☐ open (mechanism landed + unit-proven; the live koel acceptance proof is unobtainable without a model credential) |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-27 | **#324 (FIX-324D) AC-3 Cause C mechanism landed; live proof still owed.** Stage 4 proposes from the SOURCE inventory built at stage 13, which executes BEFORE the crawl (`STAGE_EXECUTION_ORDER` = 0,1,2,13,3,4,5,…), so `observedForms` is necessarily `[]` and the proposer was form-blind. Fixed with a POST-CRAWL re-proposal pass at stage 6 — the first point where a runtime-fused inventory exists. The pass is recorded on stage 6's own artifact and the content-hashed stage-4 artifact is NEVER rewritten (owner-approved design: silently rewriting a hashed artifact to improve a coverage ratio would invalidate the exit gate that ratio is measured by). The frozen `@arxic/intent-proposal-spike` alias and its `Equal<>` lockstep are untouched: the form signal travels BESIDE the rows as consumer row ids, not as a new field on `ProposalConsumerRow`. The pass is ADDITIVE — every failure path yields zero proposals plus an OBSERVED-severity diagnostic, so a run stage 4 already satisfied can never be failed by it — and its proposals travel through the SAME binding, dedupe, dangling-citation and no-`verified` gates as stage 4's, both in the proposer and again in the ledger. **The AC-3 acceptance proof (a live koel round where >=1 proposal cites a form-backed row) was NOT produced: no model credential exists in this environment.** No campaign was run, no ratio was produced, no spend was incurred. Next: #324 AC-4 remeasurement once the owner supplies the credential. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-324D post-crawl form-availability signal (#324): the intent proposer was form-blind because stage 13 builds the domain inventory before the crawl, so `observedForms` was always empty at proposal time. A bounded post-crawl re-proposal pass now runs at stage 6 over rows the crawl observed a submittable form for and stage 4 left unbound, and the intent ledger joins its proposals exactly like stage-4 proposals. The pass is recorded on the stage-6 artifact; the content-hashed stage-4 artifact is never rewritten. It is additive and fail-closed: no budget headroom, no form-backed row, a provider failure or a throw each yield zero proposals plus an observed-severity diagnostic, and its output passes the same binding, dedupe, dangling-citation and truth-state gates as stage-4 output.
```

## 4. `VERSION` bump required?

no — internal inference plumbing and a new optional field on an internal stage artifact; no user-observable CLI or bundle surface changes.

## 5. Evidence pointers

- Real-world proof: `packages/orchestrator-langgraph/src/__tests__/post-crawl-reproposal.test.ts` — the pass driven through the unmodified frozen `ModelAdapter` against a REAL local OpenAI-compatible HTTP endpoint (`node:http`), covering the skip paths, the provider-500 path and the citation proof.
- Unit proof: `packages/domain-inventory-spike/src/__tests__/form-availability.test.ts` — `formBackedConsumerRowIds` over pre-crawl and fused inventories, including the non-extracted exclusion.
- Unit proof: `packages/intent/src/__tests__/ledger.test.ts` — the stage-6 union, the no-op-when-absent equality, and three fail-closed rejections.
- Unit proof: `packages/orchestrator-langgraph/src/__tests__/intent-proposer.test.ts` — the `formBacked` marker reaches the prompt, marks only backed rows, and is OMITTED entirely pre-crawl so a pre-crawl prompt is byte-identical to the pre-AC-3 prompt.
- Artifacts: none — no campaign was executed (no model credential). Ledger unchanged at $0.18277015 of the $1.00 ceiling.
- Gates: typecheck ☑ · lint ☑ · format ☑ · test ☑ · license gate ☑ (see the PR's CI run)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                        | Expected disposition                                              | Test                                                                                                               |
| -------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Crawl observed no form on any row (the pre-crawl shape)        | skipped with a stated reason, ZERO provider calls                 | `post-crawl-reproposal.test.ts` — "SKIPS with a stated reason when the crawl backed no form"                       |
| Stage 4 already bound every form-backed row                    | skipped with a stated reason, no second grind                     | `post-crawl-reproposal.test.ts` — "SKIPS … already bound every form-backed row"                                    |
| Stage-4 spend consumed the whole budget cap                    | skipped, ZERO provider calls                                      | `post-crawl-reproposal.test.ts` — "SKIPS without any provider call when the stage-4 spend left no budget headroom" |
| Provider returns 500 during the pass                           | `observed` — zero proposals, diagnostic recorded, run NOT blocked | `post-crawl-reproposal.test.ts` — "is ADDITIVE on provider failure"                                                |
| Model returns an empty proposal list                           | `observed` — recorded honestly, nothing invented                  | `post-crawl-reproposal.test.ts` — "records an empty model response honestly"                                       |
| Post-crawl proposal cites a non-extracted inventory row        | `contradicted` — ledger build fails closed                        | `ledger.test.ts` — "FAILS CLOSED on a post-crawl proposal citing a non-extracted row"                              |
| Post-crawl proposal claims `truthState: verified` (ADR-001 §2) | `contradicted` — ledger build fails closed                        | `ledger.test.ts` — "FAILS CLOSED on a post-crawl proposal claiming truthState verified"                            |
| `postCrawl.proposals` is not an array                          | `contradicted` — ledger build fails closed                        | `ledger.test.ts` — "FAILS CLOSED when postCrawl.proposals is not an array"                                         |
| Stage 6 recorded no post-crawl section (every pre-AC-3 run)    | unchanged — byte-identical ledger rows                            | `ledger.test.ts` — "is a no-op when stage 6 recorded no post-crawl section"                                        |

## 7. NOT done in this slice (read this before treating AC-3 as complete)

- **The AC-3 acceptance proof is NOT produced.** AC-3 asks for a live koel round where >=1 proposal cites a form-backed row. That requires a real campaign against the real target, and there is no `ARXIC_MODEL_API_KEY` / `ARXIC_MODEL_BASE_URL` in this environment (re-verified: no `.env`, no key material under `~/.arxic`). The equivalent property is proven at unit level against a real local endpoint — "re-proposes ONLY the form-backed unbound rows and records them" asserts a returned proposal citing a form-backed row id — but a unit proof is NOT the field proof AC-3 specifies, and this slice does not claim it is.
- **AC-4 was not attempted and no ratio was produced.** No campaign was run; no spend was incurred.
- **The effect on the grounded ratio is UNMEASURED.** The mechanism can only help rows the crawl actually reaches; how many of koel's 304 extracted rows that is has not been measured. Do not assume this closes the 49.5% → 80% gap.
- **Stage 6 now makes provider calls when a model is configured.** That is a real behavioural change to a stage that previously made none. It is bounded (one pass, `maxCoveragePasses: 0`, budget headroom subtracted from the stage-4 estimate) and skips without any call when there is nothing to do, but it should be reviewed with that in mind.
- The ledger pricing defect found alongside this work is filed separately as #337 and is NOT repaired here.
