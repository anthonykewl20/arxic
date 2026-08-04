# Tree-sitter — Provenance

| Field | Value |
|---|---|
| Upstream repo | https://github.com/tree-sitter/tree-sitter |
| Pinned ref | HEAD (no ADR pin) |
| License | MIT |
| Consumed as | source code / parser runtime |
| ADR section | §6, §7.1 |
| Local location | gears/tree-sitter/ |

## What Arxic borrows
- Structural parsing APIs used by Understand Anything TreeSitterPlugin adapter.
- Core parser runtime surfaces for incremental and deterministic language parsing.

## Notes / constraints
- DEFERRED integration paths require separate license checks for each Tree-sitter grammar before use.
- Keep each grammar treated as a separate dependency with explicit permission review.
