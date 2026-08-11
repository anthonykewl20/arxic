# M2-SENSITIVITY-PROBE — staged doc updates (charter §10.2)

Issue: #116 · PR: pending · Disposition: mixed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #116 | [M2 design + impl] Intent-backed pseudocode (IntentSpec) — ADR-004 design landed; slices A–E landed, slice F pending | 🚧 in progress (5 of 6 slices) |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-11 | **#116 (M2-SENSITIVITY-PROBE) sensitivity gate slice E DONE after blocking fail-open fix round.** Every probe first runs an unmutated control; an unusable control blocks promotion with `ARXIC-PROBE-HARNESS-UNUSABLE`, while verifier truth and stage-10 evidence remain `verified`. `@arxic/verifier` owns the real Playwright adapter, resolves `@playwright/test`, resets/seeds before every run, disables traces and screenshots, and removes each temporary directory. Real adapter + Chromium + `reference-auth-app` proved control `passed:true`, the `url:/` mutation killed, and a deliberately insensitive text assertion rejected with `ARXIC-PROBE-INSENSITIVE-ASSERTION`. **M2 #116 5/6 slices.** Next: #116 slice F. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- M2-SENSITIVITY-PROBE (#116): added a fail-closed per-assertion mutation sensitivity gate with an unmutated control, real Playwright module resolution, clean-fixture reset/seed before every run, and zero retained screenshots/traces; probe failures suppress promotion without discarding verifier truth or evidence. Real Chromium against the reference auth app proved both mutation kill and insensitive-assertion rejection.
```

## 4. `VERSION` bump required?

yes → 0.3.0, because the optional sensitivity promotion gate is a user-observable feature per `RELEASES.md`

## 5. Evidence pointers

- Real-world proof: `packages/verifier/src/real-world.test.ts` — `createSensitivityProbeAdapter` drives the real runner and Chromium against `reference-auth-app`, covering control, kill, and rejection.
- Artifacts: stdout line `Sensitivity adapter proof: {"controlPassed":true,"mutationPassed":false,"killed":true,"insensitiveKilled":false,"insensitiveDiagnostic":"ARXIC-PROBE-INSENSITIVE-ASSERTION"}`. Probe directories are empty after execution; probe runs force trace off and omit screenshot capture because this quality gate does not produce evidence artifacts.
- Gates: typecheck ☑ · typecheck:packages ☑ · lint ☑ · format ☑ · test (playwright-compiler 38 passing; verifier 38 passing; orchestrator-langgraph 86 passing) ☑ · license gate ☐ (not requested for this worktree slice)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                     | Expected disposition                                             | Test                                                                                          |
| ------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Mutated URL expectation still passes        | blocked promotion; verifier outcome remains `verified`           | `sensitivity-probe.test.ts` + orchestrator `keeps verified truth state but blocks promotion…` |
| One of multiple URL/text mutations survives | blocked promotion with exactly the surviving assertion diagnosed | `sensitivity-probe.test.ts` `probes every URL and text assertion…`                            |
| Unsupported assertion kind                  | skipped without claiming it was probed                           | `sensitivity-probe.test.ts` `skips unsupported assertion kinds…`                              |
| Unmutated control fails                     | blocked promotion with `ARXIC-PROBE-HARNESS-UNUSABLE`            | `sensitivity-probe.test.ts` `fails closed when the unmutated control…`                        |
| Probe adapter throws                        | verifier outcome/evidence retained; promotion blocked            | orchestrator `keeps verifier truth and evidence when the sensitivity probe harness throws`    |
| Real mutation survives                      | blocked promotion with insensitive-assertion diagnostic          | verifier real-world control/kill/rejection proof                                              |
