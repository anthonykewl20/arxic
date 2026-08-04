# Graphology — Provenance

| Field | Value |
|---|---|
| Upstream repo | https://github.com/graphology/graphology |
| Pinned ref | HEAD (no ADR pin) |
| License | MIT |
| Consumed as | npm public package |
| ADR section | §6 |
| Local location | gears/graphology/ |

## What Arxic borrows
- Typed graph container for evidence graph modeling (nodes and edges for routes, states, assertions, and transitions).
- Traversal utilities for neighborhood expansion and graph walk operations during batching.
- Shortest-path helpers for candidate workflow path ranking.
- Louvain community detection where needed for graph clustering heuristics.

## Notes / constraints
- Consumed as an adapter-facing runtime dependency only; no direct UI or runtime control-plane logic copied.
- Keep graph node/edge IDs fully canonical and evidence-addressed before running graph algorithms.
