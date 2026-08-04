# LangGraph — Provenance

| Field | Value |
|---|---|
| Upstream repo | https://github.com/langchain-ai/langgraphjs |
| Pinned ref | HEAD (no ADR pin) |
| License | MIT |
| Consumed as | npm public package |
| ADR section | §6, §8.1 |
| Local location | gears/langgraph/ |

## What Arxic borrows
- `StateGraph` construction and execution APIs.
- Checkpointer interfaces for durable graph checkpoints between workflow nodes.
- Retry/interrupt semantics for deterministic + agentic execution flows.
- Workflow state persistence and artifact-ID passing between nodes.

## Notes / constraints
- Keep workflow orchestration behind Arxic adapter boundaries; avoid importing non-public or internal internals.
- Contract tests gate upgrades to avoid silent behavior changes in checkpoint or retry semantics.
