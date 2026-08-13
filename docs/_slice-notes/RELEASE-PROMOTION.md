# RELEASE-PROMOTION — staged doc updates (charter §10.2)

Issue: unfiled promotion-eligibility blocker · PR: TBD · Disposition: mixed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| unfiled | [RELEASE-PROMOTION] Let advisory source/discovery observations coexist with verified promotion | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-13 | **RELEASE-PROMOTION promotion eligibility blocker DONE.** The orchestrator now distinguishes a denied operation from a denied pipeline stage: unsupported source files and destructive forms deliberately left untouched remain blocked-severity audit observations but do not make stages 1/2/5 sticky promotion blockers. Real `arxic run`, a stubbed model endpoint, the reference app, and two Chromium verifier passes produced a verified promoted bundle; failed sensitivity and integrity gates plus genuine blocked/contradicted stages remain non-promotable. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- RELEASE-PROMOTION fixed `arxic run` promotion eligibility so unsupported-file and mutation-form discovery observations remain audit-visible without blocking a later deterministic verified result; real reference-app Chromium proof now produces a promoted bundle, while sensitivity, integrity, contradiction, and genuine stage blockers remain fail-closed.
```

## 4. `VERSION` bump required?

yes → next patch, because the change makes the user-visible promoted bundle reachable from `arxic run`; the integrator owns the parallel-lane version edit.

## 5. Evidence pointers

- Real-world proof: `apps/cli/src/__tests__/real-world.test.ts` — real `arxic run` used real Tree-sitter, ast-grep, Crawlee/Chromium, the reference app, a stubbed model boundary, and two real Chromium verifier runs; it asserted `outcome: verified`, `status: completed`, a completed promotion stage, and a receipt.
- Artifacts: ephemeral sanitized verifier artifacts and the promoted bundle are validated in the per-test temporary run directory and removed after the suite; no raw trace ZIP is retained or attached.
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (929 passing) ☑ · license gate (real graph, zero rejected) ☑

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                                            | Expected disposition                                                       | Test                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Stage-10 claims verified but the sensitivity probe is insensitive or unusable                                      | verifier truth remains `verified`, promotion eligibility false, no receipt | `packages/orchestrator-langgraph/src/__tests__/sad-paths.test.ts` sensitivity-probe cases                                       |
| Verifier evidence or verify integrity gate is missing/failed                                                       | `blocked`, no promotion                                                    | `packages/orchestrator-langgraph/src/__tests__/sad-paths.test.ts` forged/missing/failed verifier-gate cases                     |
| A genuine pipeline stage is blocked or contradicted before stage 10                                                | sticky blocker remains, no receipt                                         | `packages/orchestrator-langgraph/src/__tests__/sad-paths.test.ts` soft-block case and `oracle-resolution.test.ts` conflict case |
| Stage-1/2 unsupported files and stage-5 mutation-form discovery are present, but deterministic verification passes | diagnostics retained for audit; run becomes `verified` and promotes        | orchestrator advisory-promotion test plus CLI real-world promotion test                                                         |
