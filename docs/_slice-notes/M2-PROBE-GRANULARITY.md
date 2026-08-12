# M2-PROBE-GRANULARITY — staged doc updates (charter §10.2)

Issue: refs #116 · PR: integrator to assign · Disposition: mixed (`verified` deterministic replay; `blocked` insensitive or unusable probe)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```text
| #116 | [M2-PROBE-GRANULARITY] Per-assertion sensitivity-gate granularity in the stage-10 artifact | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```text
| 2026-08-12 | **#116 follow-up (M2-PROBE-GRANULARITY) per-assertion sensitivity-gate granularity DONE.** The probe Service now returns each required assertion's transition/assertion coordinates and value-substitution/control-state-omission outcomes; stage 10 persists them while retaining aggregate promotion gating and deterministic-verifier truth-state authority. Real Playwright 1.62.1 Chromium against the real reference-auth-app proved the `url:/` assertion kills both operators. Full suite: 104 files / 896 tests. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### Changed`

```text
- M2-PROBE-GRANULARITY (refs #116): stage-10 verification artifacts now retain per-required-assertion sensitivity outcomes, including transition/assertion coordinates and both probe operators, while the existing aggregate promotion gate and verifier truth-state authority remain unchanged; real Chromium against the reference auth app proves both operators are killed for `url:/`.
```

## 4. `VERSION` bump required?

No. This widens an unfrozen run-local inspection artifact and does not change the promoted bundle or frozen external contracts.

## 5. Evidence pointers

- Real-world proof: `packages/orchestrator-langgraph/src/__tests__/intent-proof.real-world.test.ts` — Playwright 1.62.1 real Chromium drove the real `reference-auth-app`; the persisted stage-10 `url:/` assertion entry records both operators killed.
- Artifacts: ephemeral stage-10 checkpoint artifact inspected by the test; sensitivity probe traces and temporary directories remain intentionally discarded under ADR-004 §7.1.
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (896 passing) ☑ · license gate ☑

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                 | Expected disposition                                                                         | Test                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A value-substitution operator survives                  | `blocked` promotion gate; verifier outcome remains `verified` when independently established | `packages/orchestrator-langgraph/src/__tests__/sad-paths.test.ts` — `keeps verified truth state but blocks promotion when the sensitivity probe is insensitive`                                                                                                                     |
| A control-state-omission operator survives              | `blocked` promotion gate with the failing assertion/operator inspectable                     | `packages/playwright-compiler/src/sensitivity-probe.test.ts` — `blocks a value-tautology that survives action omission after value mutation is killed`                                                                                                                              |
| The unmutated control fails or the probe harness throws | `blocked` promotion gate; no probe truth-state authority                                     | `packages/playwright-compiler/src/sensitivity-probe.test.ts` — `fails closed when the unmutated control cannot run successfully`; `packages/orchestrator-langgraph/src/__tests__/sad-paths.test.ts` — `keeps verifier truth and evidence when the sensitivity probe harness throws` |
| No supported required assertion exists                  | Not promotion-eligible; no operator outcomes fabricated                                      | `packages/playwright-compiler/src/sensitivity-probe.test.ts` — `skips unsupported assertion kinds without running a suite`                                                                                                                                                          |
