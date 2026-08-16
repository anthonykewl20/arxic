# DG-03 — staged doc updates (charter §10.2)

Issue: #247 · PR: #264 · Disposition: verified (spike; conclusions provisional pending cross-review per ADR-008 §11)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #247 | [DG-03] Research spike: generalized verification — observation-derived assertions + API-level replay | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-16 (5) | **#247 (DG-03) generalized verification spike landed.** One new spike package `@arxic/verification-spike` (no forbidden-file edits, zero new external deps): observation capture over the real stage-8 driver with bounded stabilization; observation→assertion derivation (`url:<path>`/`text:<heading>`); IntentSpec binding through the real `@arxic/intent` provenance gates; an API-level replay executor (attestation→policy→lease→origin→redaction→hash gates, real `classifyVerification`); and the ADR-008 §8 truth-state policy matrix (only acceptance-backed deterministic replay reaches `verified`; characterization/corroborated-only/human-approved-only cap at `observed`). Real-engine proofs: (4a) redirect-after-login (302→/dashboard, real node:http+scrypt+sqlite app — both fixture apps redirect to `/`, so they cannot exercise #257) verifies END-TO-END via real PlaywrightCompiler+PlaywrightVerifier with derived `url:/dashboard`; the canned `url:/` twin fails both runs and reproduces the #258 masked-`blocked` classification; (4b) an HMAC-verified webhook intent replays 2× at HTTP level → `verified` with hashed redacted artifacts; wrong-signature → `contradicted`; no lease → `blocked` with zero business requests. Spike report `docs/spikes/dg-03-generalized-verification.md` (citations + recorded dissent D1–D6); evidence `docs/evidence/DG-03/`. 51 tests green. **Next: #245 (DG-01).** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### internal`

```
- DG-03 generalized verification spike (#247): new spike package `@arxic/verification-spike` proving observation-derived assertions (stage-8 capture → IntentSpec binding via real `@arxic/intent` provenance) and an attested, policy-gated, evidence-hashed API-level replay executor for non-UI intents, plus the ADR-008 §8 truth-state policy; proven with real Chromium end-to-end on a redirect-after-login app (canned `url:/` twin fails, derived `url:/dashboard` verifies) and a real HMAC-verified webhook replay; report at `docs/spikes/dg-03-generalized-verification.md`.
```

## 4. VERSION bump required?

no — research spike; nothing user-observable ships (package is private, not wired into the CLI/pipeline).

## 5. Evidence pointers

- Real-world proof 4a: `packages/verification-spike/src/__tests__/redirect-login.real-world.test.ts` — real Chromium (Playwright 1.62.1) exploration + real PlaywrightCompiler + real PlaywrightVerifier against the real in-repo redirect-login app (`src/test-app/redirect-login-app.ts`, node:http + scrypt + node:sqlite, 302 → /dashboard).
- Real-world proof 4b: `packages/verification-spike/src/__tests__/webhook-replay.real-world.test.ts` — real HTTP replay of an HMAC-SHA256-verified webhook with hashed, redacted request/response artifacts.
- Artifacts: `docs/evidence/DG-03/{observation-capture.json,api-replay-run01-webhook.json,api-replay-summary.json}` (+ README with the regeneration command).
- Spike report: `docs/spikes/dg-03-generalized-verification.md` (citations: repo file/line; GitHub URL + commit SHA for scruter 915f1f8, laravelcm 68370fa, shopier-integration e7423cb).
- Gates: typecheck ☑ · lint ☑ · typecheck:packages ☑ · format:check ☑ · test (51 new, suite green) ☑ · license gate ☑ (no new external deps)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                           | Expected disposition                                                   | Test                                                            |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| Final exploration action step fails                               | blocked (`ARXIC-DG03-OBSERVATION-STEP-FAILED`)                         | `observation.test.ts`                                           |
| Post-action observation drifts off origin                         | blocked (`ARXIC-DG03-OBSERVATION-DRIFTED`)                             | `observation.test.ts`, `derive-assertions.test.ts`              |
| Post-action state never stabilizes within budget                  | blocked (`ARXIC-DG03-OBSERVATION-UNSTABLE`)                            | `observation.test.ts`                                           |
| Observation URL unusable for derivation                           | blocked (`ARXIC-DG03-DERIVATION-EMPTY`)                                | `derive-assertions.test.ts`                                     |
| Acceptance binding without runtime evidence                       | blocked (`ARXIC_INTENT_SOURCE_AS_ACCEPTANCE`, real gate)               | `intent-binding.test.ts`                                        |
| Divergent acceptance expected values, same id                     | contradicted (`ARXIC_INTENT_ORACLE_CONFLICT`, real gate)               | `intent-binding.test.ts`                                        |
| Unattested target / production-looking attestation                | blocked, zero business requests (`ARXIC-DG03-ATTESTATION-*`)           | `api-replay-gates.test.ts`                                      |
| Mutating replay without lease / expired lease                     | blocked, zero business requests (`ARXIC-DG03-POLICY-DENIED`)           | `api-replay-gates.test.ts`, `webhook-replay.real-world.test.ts` |
| Destructive method without recorded approval                      | blocked, zero business requests                                        | `api-replay-gates.test.ts`                                      |
| Forbidden substring in request path (cannot redact)               | blocked pre-flight (`ARXIC-DG03-REDACTION-FAILED`)                     | `api-replay-gates.test.ts`                                      |
| Step path resolving off the attested origin (absolute-URL escape) | blocked pre-flight, zero business requests (`ARXIC-DG03-ORIGIN-DRIFT`) | `api-replay-gates.test.ts`                                      |
| Fixture reset/seed failure mid-run                                | blocked (`ARXIC-VERIFY-BLOCKED-FIXTURE`)                               | `api-replay-gates.test.ts`                                      |
| All replay runs fail expectations (wrong HMAC server-side)        | contradicted (`ARXIC-VERIFY-APP-DEFECT`)                               | `api-replay-gates.test.ts`, `webhook-replay.real-world.test.ts` |
| Split runs (flaky)                                                | contradicted (`ARXIC-VERIFY-FLAKY-RUNS`)                               | `api-replay-gates.test.ts`                                      |
| Zero requiredRuns                                                 | blocked (`ARXIC-VERIFY-SUITE-UNAVAILABLE`)                             | `api-replay-gates.test.ts`                                      |
| Canned `url:/` literal on redirect app                            | runs [false,false]; outcome masked `blocked` (#258 reproduction)       | `redirect-login.real-world.test.ts`                             |
| Characterization replay would be `verified`                       | capped `observed` (ADR-004)                                            | `truth-policy.test.ts`, `redirect-login.real-world.test.ts`     |
