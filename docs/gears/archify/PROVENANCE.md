# Archify — Provenance

| Field | Value |
|---|---|
| Upstream repo | https://github.com/tt-a1i/archify |
| Pinned ref | 2c1f8ac2ca28a26d0b68043ec80c9554e20ff0e3 |
| License | MIT |
| Consumed as | adapted patterns + reviewed code |
| ADR section | §7.2 |
| Local location | gears/archify/ |

## What Arxic borrows
- Stable validation flow and diagnostic structure.
- Repository evidence and path/SHA normalization concepts.
- Snapshot-hash-receipt style used for atomic promotion.

## Exact seams
- `src/archify/renderers/shared/validator.mjs` — schema validation pattern seam.
- `src/archify/renderers/shared/repository-evidence.mjs` — evidence reference shaping seam.
- `src/archify/references/delivery-contract.md` — contract and output expectations reference.

## Notes / constraints
- Do not port the diagram workflow schema into Arxic; only schema diagnostics and atomic-delivery patterns are used.
- `src/repo/` is a pinned shallow HEAD reference snapshot for audit only; active vendored code stays in `src/`.
