# M2-LOCATOR-PROVENANCE — staged doc updates (charter §10.2)

Issue: #116 · PR: pending · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #116 | [M2-LOCATOR-PROVENANCE] Persist stage-8 locator provenance | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-12 | **#116 (M2-LOCATOR-PROVENANCE) Persist stage-8 locator provenance DONE.** Stage 8 now persists run-local fill/click locator records containing intent, semantic and execution locators, resolution outcome, failure reason, and an explicit same-element proof produced only after Playwright establishes referential identity. Real Playwright 1.62.1 Chromium drove the reference-auth-app `/login` controls and retained three successful identity receipts; the full local suite passed 104 files / 899 tests. Disposition: observed. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- M2-LOCATOR-PROVENANCE stage-8 locator provenance (refs #116): the Playwright adapter now surfaces an explicit same-element identity proof after semantic and execution locators resolve uniquely, while the orchestrator persists serializable run-local fill/click records in the existing stage-8 artifact. Real Playwright 1.62.1 Chromium against the reference-auth-app proves `/login` email/password fills and submit click retain the locator pairs and successful identity proof without leaking element handles or input values.
```

## 4. `VERSION` bump required?

no

## 5. Evidence pointers

- Real-world proof: `packages/orchestrator-langgraph/src/__tests__/exploration-real-world.test.ts` — real Playwright 1.62.1 Chromium drove the real `reference-auth-app` `/login` email/password controls and submit action.
- Artifacts: per-run sanitized `exploration-trace.zip` plus adjacent `.sanitization.json` provenance and named `step-00-open-login-page.png`; temporary test artifacts are removed after the run and no raw trace is retained.
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (899 passing) ☑ · license gate ☑
- Integrator follow-up (required when folding this note): remove the now-resolved locator-provenance item from ADR-004's Open Questions, and update SYNC's remaining-follow-up counts/lists and every statement that still describes locator provenance as pending. This slice worktree cannot edit those shared documents.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                   | Expected disposition                                                        | Test                                                                                                                                                                                                                                 |
| --------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Semantic/execution locators resolve to different elements | blocked, with descriptive failed provenance retained                        | `packages/orchestrator-langgraph/src/__tests__/exploration.test.ts` — `persists failed fill and click locator provenance with their executable intents`                                                                              |
| Semantic locator resolves ambiguously                     | blocked for a required step, with `semantic-ambiguous` retained             | `packages/orchestrator-langgraph/src/__tests__/exploration.test.ts` — `persists failed fill and click locator provenance with their executable intents`                                                                              |
| Locator resolution succeeds but the browser action fails  | blocked as a failed step; identity proof remains descriptive only           | `packages/orchestrator-langgraph/src/__tests__/exploration.test.ts` — `classifies an action failure after successful locator resolution as a failed step`                                                                            |
| A fill value is supplied to the execution plan            | observed provenance excludes the input value and disposable element handles | `packages/orchestrator-langgraph/src/__tests__/exploration.test.ts` — failed-provenance serialization assertion; `packages/orchestrator-langgraph/src/__tests__/exploration-real-world.test.ts` — real sanitized-trace residual scan |
