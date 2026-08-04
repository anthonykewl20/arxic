# Mailpit — Provenance

| Field | Value |
|---|---|
| Upstream repo | https://github.com/axllent/mailpit |
| Pinned ref | HEAD (no ADR pin) |
| License | MIT |
| Consumed as | container + REST API |
| ADR section | §6, §12.3 |
| Local location | gears/mailpit/ |

## What Arxic borrows
- Mailpit test container image usage for capturing outbound SMTP test messages.
- REST API endpoints for message listing/searching/deletion from isolated worker networks.

## Notes / constraints
- Mailpit is used only as a test sink on isolated worker networks, not as a production mail proxy.
- API docs reference: https://mailpit.axllent.org/docs/api-v1/
