# AJV — Provenance

| Field | Value |
|---|---|
| Upstream repo | https://github.com/ajv-validator/ajv |
| Pinned ref | HEAD (no ADR pin) |
| License | MIT |
| Consumed as | npm public package |
| ADR section | §6 |
| Local location | gears/ajv/ |

## What Arxic borrows
- JSON Schema 2020-12 validation and schema compilation.
- Strict-mode validation behavior for deterministic contract checking.
- Structured validator outputs for machine-readable diagnostics and canonical error framing.

## Notes / constraints
- Use for validation boundary control, not as generic runtime schema generation.
- Keep compiled schema artifacts pinned to the run artifacts and evidence receipts.
