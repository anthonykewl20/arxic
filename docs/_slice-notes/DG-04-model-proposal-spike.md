# DG-04-model-proposal-spike — staged doc updates (charter §10.2)

Issue: #248 · PR: #265 · Disposition: mixed (verified-by-CI for pipeline semantics; observed for real-model measurements — provisional pending cross-review per ADR-008 §11)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #248 | [DG-04] Research spike: model-driven intent proposal at scale | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-16 (5) | **#248 (DG-04) model-driven intent proposal spike DONE (research; issue stays open for cross-review).** New `@arxic/intent-proposal-spike`: schema vNext `arxic-intent-proposal-v1` (arbitrary domains, mandatory inventory-row + EvidenceRef citations, NO truth-state field, wire projection without `uniqueItems` after a measured OpenAI strict-mode 400), deterministic Domain-Inventory stand-in over read-only source-ua-adapter output (stable row ids, documented consumer contract for DG-02/DG-06), IntentProposer with per-domain vs one-shot batching, deterministic binding (dangling citations rejected), three-layer dedupe, bounded retry-then-block (fail-closed per run), IntentSpec bridge, and sanitized evidence artifacts. Real-model run (OpenRouter→OpenAI gpt-4o-mini) over real public directus @ cb846b6a (272 route rows, 80 domains): per-domain 80 calls → 202 grounded proposals, 226/272 rows, $0.0202, 333 s sequential; one-shot 1 call → 10 proposals, 10/272 rows, $0.0034, 9.9 s — one-shot collapses grounding coverage 22×. Injection defense proven over a real local node:http endpoint: instruction-like output and hostile-source payloads echoed by the model block as content-is-data; the read-only policyContext threaded through `propose()` is digest-stamped on every outcome (success and blocked) and provably unmutated across injection-block, hostile-source, retry-then-block, and succeed-after-retry runs; credentials never printed/committed (post-run grep of artifacts: zero hits). Spike report `docs/spikes/dg-04-model-proposal.md`; evidence `docs/evidence/DG-04/`. Dispositions: hypothesized/blocked/observed; nothing `verified` by model output. Next: cross-review, then DG-08 (#252) + DG-02 (#246) consume the contracts. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- DG-04 model-driven intent proposal spike (#248): `@arxic/intent-proposal-spike` — schema vNext `arxic-intent-proposal-v1` binding arbitrary-domain IntentSpec proposals to Domain-Inventory rows (mandatory inventory + EvidenceRef citations, no truth-state field, wire projection for strict structured outputs), deterministic inventory stand-in + documented DG-02/DG-06 consumer contract, IntentProposer (per-domain/one-shot batching, deterministic binding + dedupe, bounded retry-then-block, hypothesized-only), real-endpoint scale evidence (directus 272 rows via OpenRouter/gpt-4o-mini: per-domain $0.0202/202 grounded proposals vs one-shot $0.0034/10) and injection-defense proofs over a real local OpenAI-compatible endpoint.
```

## 4. VERSION bump required?

no — research spike; no user-observable surface ships (package is private, workspace-internal)

## 5. Evidence pointers

- Real-world proof: `packages/intent-proposal-spike/src/__tests__/real-world.test.ts` — real Tree-sitter (`SourceUaAdapter`) scans of BOTH real fixture apps → stand-in inventory → real local OpenAI-compatible `node:http` endpoint → grounded, deduped, non-auth proposals; deterministic across repeat runs.
- Real-model evidence: `docs/evidence/DG-04/` (`scale-matrix.json`, `inventory-summary.json`, `real-model-probe.json`) — real OpenRouter→OpenAI gpt-4o-mini calls over directus @ `cb846b6a1ddc4811359bc52b74bb31a42eab33db`; sanitized (live-key grep: zero hits).
- Spike report: `docs/spikes/dg-04-model-proposal.md` (schema design, dedupe rules, measured-vs-estimated cost/latency, injection-defense evidence, citations, open decisions incl. dissent).
- Gates: typecheck ☐ · lint ☐ · format ☐ · test (35 passing in-slice; full repo `pnpm test`) ☐ · license gate ☐ (no new external deps beyond already-allowed ajv/ajv-formats)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                        | Expected disposition                                                            | Test                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------- |
| Model output stays malformed (non-JSON) across bounded retries | blocked, zero proposals, `ARXIC-MODEL-RETRIES_EXHAUSTED`                        | `sad-paths.test.ts`                       |
| Schema-invalid (parseable) output, first attempt               | retried once, then accepted when corrected                                      | `sad-paths.test.ts`                       |
| Instruction-like model output (injection in rationale)         | blocked as content-is-data; policyContext digest-read + provably unmutated      | `sad-paths.test.ts`                       |
| Hostile-source injection payload echoed by model               | blocked; payload traveled strictly inside the DATA block                        | `sad-paths.test.ts`                       |
| Dangling inventory-row citation                                | proposal rejected `ARXIC-PROPOSAL-INVENTORY-REF-DANGLING`, ledger honest        | `sad-paths.test.ts`                       |
| Dangling EvidenceRef citation                                  | proposal rejected `ARXIC-PROPOSAL-EVIDENCE-REF-DANGLING`                        | `sad-paths.test.ts`                       |
| Empty proposal list (honest zero)                              | ok with zero proposals, full uncovered-row ledger, no retry loop                | `sad-paths.test.ts`, `real-world.test.ts` |
| Credentials unresolvable                                       | blocked `ARXIC-MODEL-PROVIDER-ERROR` (also the CI path for the real-model test) | `sad-paths.test.ts`, `real-model.test.ts` |
| Scale matrix invoked without target repo                       | blocked `ARXIC-PROPOSAL-SCALE-TARGET-MISSING`                                   | `real-model.test.ts`                      |
| Duplicated model proposals                                     | deduped deterministically; every survivor `hypothesized`                        | `sad-paths.test.ts`                       |
