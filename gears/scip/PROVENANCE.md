# SCIP — Provenance

| Field | Value |
|---|---|
| Upstream repo | https://github.com/scip-code/scip |
| Pinned ref | HEAD (no ADR pin) |
| License | Apache-2.0 |
| Consumed as | reference (deferred) |
| ADR section | §6.1 |
| Local location | gears/scip/ |

## What Arxic borrows
- Protocol schema shape for symbol/index payloads as a candidate precision adapter.
- Potential gap-coverage strategy for source-indexed symbol graph enrichment.

## Notes / constraints
- Deferred as a SourceIndexer extension until a cross-file precision gap is proven.
- Includes `scip.proto` for schema reference.
