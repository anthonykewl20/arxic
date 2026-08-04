# Testcontainers — Provenance

| Field | Value |
|---|---|
| Upstream repo | https://github.com/testcontainers/testcontainers-node |
| Pinned ref | HEAD (no ADR pin) |
| License | MIT |
| Consumed as | npm public API |
| ADR section | §6, §16.1 |
| Local location | gears/testcontainers/ |

## What Arxic borrows
- `GenericContainer` orchestration for throwaway dependent services.
- `Network` creation and teardown helpers for isolated test environments.
- Wait strategies to gate test start-up readiness deterministically.

## Notes / constraints
- Keep container control restricted to trusted control workers; no untrusted app/browser has unrestricted Docker daemon access.
- Containers are disposable and environment scoped, with explicit allow/deny policies and lifecycle accounting.
