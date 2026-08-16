# @arxic/intent-proposal-spike

DG-04 research spike (#248): model-driven intent proposal at scale. Proposes
arbitrary-domain `IntentSpec` hypotheses from Domain-Inventory rows through the
frozen `@arxic/model-adapter` structured-output boundary.

**Status: research spike — conclusions provisional** pending cross-review
(ADR-008 §11). Feeds ADR-008, DG-02/DG-06 (inventory contract), DG-08
(#252, IntentProposer productionization) and #255 (real-model program).

## What is here

- `src/schema.ts` — structured-output schema vNext
  (`arxic-intent-proposal-v1`): arbitrary-domain proposals, mandatory
  inventory-row + EvidenceRef citations, **no truth-state field** (model output
  is data), plus a strict-mode wire projection (`INTENT_PROPOSAL_WIRE_SCHEMA`,
  `uniqueItems` stripped — OpenAI strict structured outputs rejects it).
- `src/inventory.ts` — **provisional stand-in** for the DG-02 Domain Inventory:
  deterministic route/page rows over `@arxic/source-ua-adapter` output shapes.
  The consumer contract DG-02/DG-06 must satisfy is documented in the file
  header.
- `src/proposer.ts` — `IntentProposer`: per-domain vs one-shot batching,
  content-as-data messages, deterministic binding (dangling citations
  rejected), dedupe (in-batch / cross-batch / cross-run ledger merge),
  bounded retry-then-block (fail-closed per run), `truthState` pinned to
  `hypothesized`, cost-model token estimator, IntentSpec bridge.
- `src/scale-run.ts` — scale-matrix runner (real target repo → both
  strategies → sanitized evidence artifacts).
- `scripts/` — reproducibility runners (`count-inventory.ts`,
  `run-scale-matrix.ts`; credentials via env only, never printed or written).

## Safety invariants (tested, sad-path-first)

- Malformed model output → bounded corrective retry → run **blocked**, no
  partial acceptance (stage-4 semantics unchanged).
- Instruction-like model output (or a hostile repo payload echoed by the
  model) → blocked as content-is-data; the policy context object is never
  mutated by model output.
- Proposals citing nonexistent inventory rows or unresolvable EvidenceRefs are
  **rejected** with stable `ARXIC-PROPOSAL-*` diagnostics (honest ledger, no
  silent drops).
- Artifacts are sanitized against the live credential before writing
  (`sanitizeArtifactJson`), with `0600/0640` permissions.

## Spike evidence

See `docs/evidence/DG-04/` (real OpenRouter→OpenAI gpt-4o-mini runs over the
real public `directus/directus` repository at commit `cb846b6a`, 272 route
rows) and the spike report `docs/spikes/dg-04-model-proposal.md`.
