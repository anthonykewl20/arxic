# DG-09 — staged doc updates (charter §10.2)

Issue: #253 · PR: #269 · Also resolves: #258 (refs #258; issue stays open for the orchestrator) · Disposition: verified

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #253 | [DG-09] Implement: generalized compiler — observation-bound assertions + generic form-flow executor | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-17 | **#253 (DG-09) generalized compiler + honest failure classification landed.** Productionized DG-03 into the real packages (spike untouched as evidence, code extracted not imported): `@arxic/playwright-compiler` gains `observation-capture.ts` (pre-flight origin gate + bounded stabilization over the real stage-8 driver; new workspace-only dep `@arxic/playwright-agent-adapter`), `observation-assertions.ts` (derive `url:<path>`/`text:<heading>` + bind into Workflow with runtime evidence; provenance classification stays in `@arxic/intent` per ADR-004 dependency direction), `form-flow.ts` (generic form-flow executor parameterized by inventory data — route, labelled fields + input refs, submit control — no domain literals), an additive `Submit … via "<control>"` spec-generator grammar so the submit control comes from inventory rather than the fixed auth list, and `test-support/redirect-login-app.ts` (real node:http+scrypt+sqlite app, 302→/dashboard, + a generic NON-AUTH newsletter flow). **#258 resolved in `@arxic/verifier`**: `classifyVerification` now classifies real run failures FIRST (all-fail → `contradicted` APP-DEFECT, split → `contradicted` FLAKY) with the artifact-gate failure reported ALONGSIDE instead of instead, and failed runs retain bounded, ANSI-stripped, persona-redacted failure evidence via new `ARXIC-VERIFY-RUN-FAILURE` diagnostics + `failure-evidence.ts`. Real-Chromium proofs: the exact campaign case (redirect-after-login) verifies END-TO-END through capture→derive→build→compile→verify (two clean replays → `verified`); the canned `url:/` twin now classifies `contradicted` with the assertion text retained (`Expected …/ / Received …/dashboard`) — the #258 acceptance repro, evidence at `docs/evidence/DG-09/defect-258-regression.json`; the generic newsletter flow verifies end-to-end; full two-fixture-app regression matrix green (1320 tests / 160 files). Three legacy verifier unit tests that asserted the OLD masking order were flipped per the #258 mandate (disclosed); the DG-03 spike's canned-literal assertion was minimally updated to the fixed behavior (disclosed; spike otherwise untouched). **Next: #251 (DG-07).** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- DG-09 generalized compiler + honest failure classification (#253, resolves the verifier defect #258 — refs #258): `@arxic/playwright-compiler` now captures post-action runtime observation (pre-flight origin gate, bounded stabilization over the stage-8 driver), derives observation-bound assertions (`url:<path>`/`text:<heading>`), binds them into Workflow IR with runtime evidence, and compiles generic form flows parameterized by inventory data via a new `Submit … via "<control>"` grammar (compile-policy gates unchanged); `@arxic/verifier` no longer masks real test failures behind `ARXIC-VERIFY-ARTIFACT-MISSING` — run failures classify `contradicted` with retained, redacted failure evidence (`ARXIC-VERIFY-RUN-FAILURE`) and the artifact gate reported alongside. Proven on real Chromium: redirect-after-login (302→/dashboard) verifies end-to-end; the canned `url:/` twin contradicts honestly with its failure reason retained.
```

## 4. VERSION bump required?

yes → integrator decision: user-observable (verification failure output changes meaning; compiler gains capabilities). Suggest patch (0.1.2) since no contract changed — per RELEASES.md the integrator confirms.

## 5. Evidence pointers

- Real-world proof (#253 acceptance): `packages/playwright-compiler/src/observation-form-flow.real-world.test.ts` (real-Chromium capture + observation-bound compilation, auth and non-auth domains) and `packages/verifier/src/redirect-verification.real-world.test.ts` (campaign case verifies end-to-end; canned twin contradicts honestly; newsletter flow verifies).
- #258 regression evidence: `docs/evidence/DG-09/defect-258-regression.json` (+ README with the regeneration command) — diagnostic order APP-DEFECT → RUN-FAILURE ×2 → ARTIFACT-MISSING, retained assertion text, no persona leakage.
- Two-fixture-app regression matrix: `packages/verifier/src/real-world.test.ts`, `packages/playwright-compiler/src/real-world.test.ts`, `packages/auth-domain-pack/src/real-world.test.ts` — all green in the full run.
- Gates: typecheck ☑ · lint ☑ · typecheck:packages ☑ · format:check ☑ · test (1320 passing / 160 files, full repo) ☑ · license gate ☑ (workspace-only new dep; no new external deps)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                        | Expected disposition                                                                    | Test                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Off-origin observation step URL                | blocked PRE-FLIGHT, zero navigations (`ARXIC-COMPILE-OBSERVATION-DRIFT`)                | `observation-capture.test.ts`                                                   |
| Final exploration action step fails            | blocked (`ARXIC-COMPILE-OBSERVATION-STEP-FAILED`)                                       | `observation-capture.test.ts`                                                   |
| Post-action state never stabilizes             | blocked (`ARXIC-COMPILE-OBSERVATION-UNSTABLE`)                                          | `observation-capture.test.ts`                                                   |
| Observation URL unusable for derivation        | blocked (`ARXIC-COMPILE-DERIVATION-EMPTY`)                                              | `observation-assertions.test.ts`                                                |
| Observed URL drifted off origin                | blocked (`ARXIC-COMPILE-OBSERVATION-DRIFT`)                                             | `observation-assertions.test.ts`                                                |
| Binding with zero derived assertions           | blocked (never an assertion-less transition)                                            | `observation-assertions.test.ts`                                                |
| Form flow with zero inventoried fields         | blocked (`ARXIC-COMPILE-UNSUPPORTED-STEP`)                                              | `form-flow.test.ts`                                                             |
| Form flow whose observation yields nothing     | blocked                                                                                 | `form-flow.test.ts`                                                             |
| All runs fail + artifact gate fails (#258)     | `contradicted` APP-DEFECT first, RUN-FAILURE evidence retained, artifact gate alongside | `classify.test.ts`, `index.test.ts`, `redirect-verification.real-world.test.ts` |
| Split runs + artifact gate fails (#258)        | `contradicted` FLAKY first, artifact gate alongside                                     | `classify.test.ts`, `index.test.ts`                                             |
| All runs pass + artifact gate fails            | `blocked` (verified requires intact artifacts — unchanged)                              | `classify.test.ts`                                                              |
| Execution diagnostics with failing runs        | `blocked` (infra outranks run outcome — unchanged)                                      | `classify.test.ts`                                                              |
| Failure output containing persona secrets      | redacted `[REDACTED]` in retained evidence                                              | `failure-evidence.test.ts`, `redirect-verification.real-world.test.ts`          |
| Pathological/opaque failure output             | bounded ≤500 chars, stable fallback                                                     | `failure-evidence.test.ts`                                                      |
| Canned `url:/` on redirect app (campaign case) | runs [false,false]; `contradicted` with retained reason (post-#258)                     | `redirect-verification.real-world.test.ts`, `verification-spike` regression     |
