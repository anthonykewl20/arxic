# otplib — Provenance

| Field | Value |
|---|---|
| Upstream repo | https://github.com/yeojz/otplib |
| Pinned ref | HEAD (no ADR pin) |
| License | MIT |
| Consumed as | npm public package |
| ADR section | §6, §12.3 |
| Local location | gears/otplib/ |

## What Arxic borrows
- RFC-compatible HOTP/TOTP generation APIs for deterministic test persona flows.
- Time-step and secret-based token derivation helpers for test fixtures.

## Notes / constraints
- Secrets are fixture-only, opaque values and remain redacted in artifacts and outputs.
- Use pinned major version policy when wiring production package references.
