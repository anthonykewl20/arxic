# SCIP TypeScript — Provenance

| Field | Value |
|---|---|
| Upstream repo | https://github.com/sourcegraph/scip-typescript |
| Pinned ref | HEAD (no ADR pin) |
| License | Apache-2.0 |
| Consumed as | reference (deferred) |
| ADR section | §6.1 |
| Local location | gears/scip-typescript/ |

## What Arxic borrows
- Protocol integration patterns as a possible TypeScript symbol precision layer.
- Adapter design cues for symbol indexing and workspace mapping.

## Notes / constraints
- Deferred as a SourceIndexer extension candidate; not part of core today.
- No source vendored or linked into runtime.
