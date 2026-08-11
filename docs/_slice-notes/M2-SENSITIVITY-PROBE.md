# M2-SENSITIVITY-PROBE — staged doc updates (charter §10.2)

Issue: #116 · PR: pending · Disposition: mixed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #116 | [M2 design + impl] Intent-backed pseudocode (IntentSpec) — ADR-004 design landed; slices A–E landed, slice F pending | 🚧 in progress (5 of 6 slices) |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-11 | **#116 (M2-SENSITIVITY-PROBE) sensitivity gate slice E DONE.** `@arxic/playwright-compiler` now mutates every supported required-transition assertion expectation in isolation and requires the normal Playwright path to fail; `@arxic/orchestrator-langgraph` gates promotion without changing the verifier's truth state. Real Chromium against `reference-auth-app` killed the `url:/` → `url:/__arxic-probe-never__` mutation. Insensitive mutations produce blocked `ARXIC-PROBE-INSENSITIVE-ASSERTION` diagnostics. **M2 #116 5/6 slices.** Next: #116 slice F. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- M2-SENSITIVITY-PROBE (#116): added a full per-assertion mutation sensitivity gate that re-renders isolated Playwright suites through a runner-injected compiler Service and suppresses orchestrator promotion when a broken expectation still passes, without changing verifier truth-state authority; real Chromium against the reference auth app killed the mutated login URL expectation.
```

## 4. `VERSION` bump required?

yes → 0.3.0, because the optional sensitivity promotion gate is a user-observable feature per `RELEASES.md`

## 5. Evidence pointers

- Real-world proof: `packages/playwright-compiler/src/real-world.test.ts` — real Playwright Chromium ran the mutated login assertion against `reference-auth-app`.
- Artifacts: stdout line `Sensitivity proof: reference-auth-app url:/ → url:/__arxic-probe-never__ killed=true`; isolated probe directories and any raw failure traces are removed after the test.
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (playwright-compiler 38 passing; orchestrator-langgraph 85 passing) ☑ · license gate ☐ (not requested for this worktree slice)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                     | Expected disposition                                             | Test                                                                                          |
| ------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Mutated URL expectation still passes        | blocked promotion; verifier outcome remains `verified`           | `sensitivity-probe.test.ts` + orchestrator `keeps verified truth state but blocks promotion…` |
| One of multiple URL/text mutations survives | blocked promotion with exactly the surviving assertion diagnosed | `sensitivity-probe.test.ts` `probes every URL and text assertion…`                            |
| Unsupported assertion kind                  | skipped without claiming it was probed                           | `sensitivity-probe.test.ts` `skips unsupported assertion kinds…`                              |
