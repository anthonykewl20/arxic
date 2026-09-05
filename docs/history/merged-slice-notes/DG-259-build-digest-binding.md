# DG-259-build-digest-binding — staged doc updates (charter §10.2)

Issue: #259 · PR: #TBD · Disposition: verified

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #259 | [DG-259] Attestation buildDigest: independent expectation source + tamper-evidence | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-24 | **#259 (DG-259) attestation buildDigest binding DONE.** The stage-0 gate no longer trusts the target's own endpoint as its expectation: new operator-side `target.expectedBuildDigest` (64-hex, validated) flows config→`OrchestratorInput.expectedBuildDigest`→`buildAttestationPolicy({expectedBuildDigest})`; the local executor's self-referential fetch (`targetBuildDigest` fed back as the gate expectation) is removed — the served digest is still RECORDED as the run's `appBuildDigest` evidence input but never compared against itself. Tamper repro proven at the orchestrator seam: a target serving a tampered digest while the operator pinned the true one refuses at stage 0 with `ARXIC-ATTESTATION-BUILD-DIGEST-MISMATCH`, status failed, zero later stages, zero artifacts; the legacy self-sourced path produces no fake binding either. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- DG-259 attestation buildDigest binding (#259): the stage-0 attestation gate now verifies `buildDigest` against an operator-pinned expectation (`target.expectedBuildDigest`, 64 hex chars) instead of a digest fetched from the target's own attestation endpoint — previously the local lane compared the attestation against itself, so a tampered digest passed with zero diagnostics. A pinned mismatch refuses the run at stage 0 with `ARXIC-ATTESTATION-BUILD-DIGEST-MISMATCH` and nothing later executes; without a pin, `local-test` targets remain trust-on-first-use and the served digest is recorded as evidence only.
```

## 4. VERSION bump required?

no — additive optional config knob + a defect fix in the gate wiring; no existing valid config changes behavior (an unpinned config behaves as before, except the self-fetch no longer silently creates a passing "expectation").

## 5. Evidence pointers

- Real-world tamper repro: `packages/orchestrator-langgraph/src/__tests__/attestation-digest-binding.real-world.test.ts` — a real HTTP attestation server serving a tampered digest; the orchestrator (real LangGraph stage machine, real checkpointer) refuses at stage 0, `failed`/`blocked`, zero completed stages, zero committed artifacts, mismatch diagnostic present. Second test pins the legacy `appBuildDigest` path so it can never masquerade as a binding again.
- Config contract: `apps/cli/src/__tests__/attestation-digest-binding.test.ts` — YAML acceptance, three invalid-shape rejections (`ARXIC-CONFIG-INVALID` at `config.target.expectedBuildDigest`), `toOrchestratorInput` wiring, and unpinned passthrough.
- Regression: `packages/environment` (129 tests incl. the attestation suite), CLI config + local-executor suites, orchestrator input-fingerprint suite — all green after the change.

## 6. Sad paths proved

| Trigger                                                   | Expected disposition                                                                                                     | Test                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| Operator pins true digest; target serves tampered digest  | stage 0 refuses `ARXIC-ATTESTATION-BUILD-DIGEST-MISMATCH` (blocked, fatal), status `failed`, no later stage, no artifact | real-world test 1     |
| Legacy `appBuildDigest` (self-served) supplied, no pin    | NO digest-mismatch diagnostic (the value never acts as an expectation); TOFU local-test proceeds and records it          | real-world test 2     |
| Config `expectedBuildDigest` not 64-hex / not hex / empty | `ARXIC-CONFIG-INVALID` at `config.target.expectedBuildDigest`                                                            | config test `it.each` |
| No pin configured                                         | `OrchestratorInput.expectedBuildDigest` undefined (documented TOFU)                                                      | config test 4         |

## 7. What was NOT done (reporting discipline)

- `apps/worker/src/main.ts` still self-fetches `targetBuildDigest` into `appBuildDigest` (line ~46). That lane now can NEVER turn it into a fake gate expectation (the orchestrator ignores `appBuildDigest` for gating — test 2 pins this), so the defect itself is closed there too; wiring `RunSpec.config.target.expectedBuildDigest` through `orchestratorInput()` for the worker lane is a one-spread follow-up I left because the worker `RunSpec` type is shared with the #288 slice's worktree (merge-conflict risk in the same file), and the worker lane is not the campaign lane. Flagged for the integrator.
- The non-local branch of the gate (`expectedBuildDigest === undefined && environmentClass !== 'local-test'` → mismatch) still exists and now composes correctly with the operator pin; no `preview`/`staging` live-server e2e was added for the pin path (local-test covers the comparison logic itself, which is shared).
- No HMAC receipt changes (`ARXIC_ATTESTATION_RECEIPT_KEY` path untouched).
