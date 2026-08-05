# @arxic/m0-pipeline

`@arxic/m0-pipeline` is the thin Milestone 0 capstone orchestrator for one manually supplied login `Workflow`. It composes the M0 capability adapters and is superseded by the shipped `@arxic/orchestrator-langgraph` Milestone 1 control plane (#17).

| Stage | Capability                                                                   |
| ----- | ---------------------------------------------------------------------------- |
| 0     | `@arxic/environment` target attestation                                      |
| 1–3   | `@arxic/ast-grep-adapter` committed login route, handler, and guard evidence |
| 9     | `@arxic/playwright-agent-adapter` workflow-to-spec compilation               |
| 10    | Deterministic verifier using the adapter fallback runner in real Chromium    |
| 12    | `@arxic/bundle-promoter` atomic publication                                  |

The deterministic verifier is the only component that assigns `verified`. It requires the configured number of consecutive clean-fixture passes, runtime observations for every required transition, retained screenshots and traces, and compliance with the network-error policy. A pass/fail split and all-failed runs are `contradicted`; missing runtime evidence is `blocked`.

Promotion happens only after `verified`. The bundle promoter atomically replaces public bytes and preserves the prior last-known-good bundle if a later run or promotion fails. Promoted metadata includes the frozen manifest, workflow, source evidence index, artifact hashes, NOTICE, provenance, and replay plan.

This M0-only action layer owns sequencing and failure classification while environment, source analysis, browser execution, and promotion remain adapter capability blocks. See ADR-001 §9, §14, §15, §22, and §23.
