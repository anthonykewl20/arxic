# M2-PROBE-CONTROL-STATE — staged doc updates (charter §10.2)

Issue: #116 · PR: pending · Disposition: mixed (`blocked` tautology; sensitive controls pass)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #116 | [M2 design + impl] Intent-backed pseudocode (IntentSpec) — ADR-004 **Accepted** (2026-08-11); **slices A–F landed** + mixed-spec `hasAcceptance` and control-state omission follow-ups; 3 post-acceptance follow-ups remain | ☑ done (6 of 6 slices + 2 follow-ups) |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-12 | **#116 (M2-PROBE-CONTROL-STATE) sensitivity hardening shipped.** ADR-004 §7.1 now authorizes an isolated per-assertion control-state omission operator. The compiler probe runs value substitution plus action omission after separate reset/seed cycles; a real Chromium login proof catches `text:Email` as a value-tautology and emits `ARXIC-PROBE-INSENSITIVE-ASSERTION` as `blocked`, while the genuine `url:/` proof kills both operators. Full suite: 104 files, 896 tests passing. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### security`

```
- M2-PROBE-CONTROL-STATE hardened assertion sensitivity (#116): generated probes now test both expected-value wiring and action dependency using isolated, reset-seeded control-state specs. Passing without the transition action blocks promotion as `ARXIC-PROBE-INSENSITIVE-ASSERTION`; real Chromium against the reference auth app proves the gate catches a value-tautology that value substitution alone misses.
```

## 4. `VERSION` bump required?

no — this is internal pre-1.0 verification-gate hardening and does not change the public package contract.

## 5. Evidence pointers

- Real-world proof: `packages/verifier/src/real-world.test.ts` — real Playwright 1.62.1 Chromium ran the value and omission operators against the real reference-auth-app after fresh reset/seed cycles; `text:Email` passed without login and was blocked.
- Artifacts: none retained by design; the adapter discarded traces and removed every temporary probe directory, and the test asserted the probe parent was empty.
- Gates: typecheck ☑ · typecheck:packages ☑ · lint ☑ · format ☑ · test (104 files, 896 passing) ☑ · license gate (real dependency graph, zero rejected packages) ☑

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                             | Expected disposition                                                                               | Test                                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Unmutated control fails                             | `blocked` (`ARXIC-PROBE-HARNESS-UNUSABLE`), zero operators probed                                  | `sensitivity-probe.test.ts` — “fails closed when the unmutated control cannot run successfully”                    |
| Value mutation survives                             | `blocked` (`ARXIC-PROBE-INSENSITIVE-ASSERTION`)                                                    | `sensitivity-probe.test.ts` — insensitive URL and multi-assertion cases                                            |
| Assertion passes with the transition action omitted | `blocked` (`ARXIC-PROBE-INSENSITIVE-ASSERTION`), verifier truth unchanged and promotion ineligible | Unit runner-boundary control experiment plus `real-world.test.ts` real-Chromium `text:Email` value-tautology proof |
| Assertion kind is unsupported                       | Fail closed with no control or mutation run (`probed: 0`)                                          | `sensitivity-probe.test.ts` — `role:alert` case                                                                    |
| Both value and omission mutations fail              | Sensitivity gate passes; no diagnostic                                                             | Unit `url:/` case and real-Chromium reference login proof                                                          |

Known residuals:

- Multi-transition intermediate-state omission: the omission operator navigates to `statePath(transition.from)` directly, so for a non-first transition whose from-state is only reachable in the control run via earlier transitions, the omission run may fail for the wrong reason and under-detect. Strictly additive (never over-detects, never unblocks a previously-blocked candidate); both fixture-app auth flows today are single-transition so unaffected. Tracked as an ADR-004 §7.1 residual.
