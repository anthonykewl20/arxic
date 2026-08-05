# `@arxic/evidence-graph`

Graphology-backed evidence/coverage graph (ADR §8.4) that wires static
extraction into typed, content-addressed graph artifacts. It is a
service-layer container: it owns node/edge mechanics, deterministic
serialization, and structural-conflict detection. Final truth-state
classification stays in orchestration (`@arxic/orchestrator-langgraph`,
`@arxic/reconciler`).

## Seams

- Node kinds: `Repository`, `Revision`, `File`, `Symbol`, `Config`, `Route`,
  `Endpoint`, `UiSurface`, `Control`, `Handler`, `Guard`, `Validator`,
  `Document`, `RuntimeSurface`.
- Edge kinds: `contains`, `revises`, `defines`, `imports`, `calls`, `renders`,
  `handles`, `guards`, `validates`, `configures`, `exposes`.
- **Output-influencing edges MUST carry ≥1 `EvidenceRef`** (ADR §8.4) — enforced
  both at compile time (a non-empty tuple type) and at runtime (rejected with a
  stable `ARXIC-GRAPH-001` `blocked` diagnostic).
- Conflicting structural attributes for the same node/edge id surface as
  `ARXIC-GRAPH-002`/`ARXIC-GRAPH-003` `contradicted` diagnostics for the
  orchestrator to classify.

## Bridging the frozen contract

The frozen `EvidenceEvent` (`{ ref } | { diagnostic }`) intentionally carries no
graph semantics. `GraphIngestEvent` is the local bridge: callers attach explicit
node/edge meaning. `buildStaticEvidenceGraph` maps the richer adapter outputs
(`NormalizedSourceIndex` from `@arxic/source-ua-adapter`, `AstGrepScanResult`
with `.matches`/`.chains` from `@arxic/ast-grep-adapter`) into the graph,
connecting `route --handles--> handler --guards--> guard` for connected auth
feature chains. The frozen §10 contracts are unchanged.

## Determinism

Canonical JSON/JSONL sort object keys and order nodes/edges by id, so identical
inputs produce byte-identical output before timestamps. `createContentAddressed`
SHA-256-addresses both forms. A property test rebuilds the same graph twice and
asserts identical canonical bytes; the real-fixture test rebuilds with differing
adapter timestamps and re-asserts identity. The SQLite catalog is intentionally
deferred — canonical sorted JSON/JSONL is the source of truth.
