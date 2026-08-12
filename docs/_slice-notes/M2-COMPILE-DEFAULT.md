# M2-COMPILE-DEFAULT — staged doc updates (charter §10.2)

Issue: refs #116 · PR: pending · Disposition: mixed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #116 | [M2-COMPILE-DEFAULT] Replace the fallback default compiler with the full Playwright compiler | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-12 | **#116 follow-up (M2-COMPILE-DEFAULT) full default compiler DONE.** Stage 9's internal default now adapts `PlaywrightCompiler.compile` into `CompilationResult`, retains its complete plan and staged bundle, and classifies compiler throws as blocked diagnostics without leaking raw exception prose. Real Chromium against `reference-auth-app` proved a dual-evidence login candidate compiles through the default path with no injected compile option; sad paths prove no-candidate remains observed/uncompiled and missing evidence blocks without an uncaught exception. The intended tightening rejects unsupported assertion intents and requires source plus runtime evidence with a matching commit. Gates: see slice report. refs #116. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### Changed`

```
- M2-COMPILE-DEFAULT full stage-9 compiler adapter (refs #116): the orchestrator's uninjected compile path now uses the policy-gated `PlaywrightCompiler`, emits its full manifest, evidence index, artifacts, and plan as a staged bundle, and converts safe structured compiler diagnostics to blocked compilation results. This intentionally tightens behavior: unsupported assertion intents are rejected instead of becoming catch-all text assertions, and compilation requires source plus runtime evidence whose source commit matches the workflow. Real Chromium against `reference-auth-app` proves the default path stages a bundle and proceeds to verification without a redundant compile.
```

## 4. `VERSION` bump required?

yes → integrator chooses the pre-1.0 patch version, because default compilation behavior is user-observable per `RELEASES.md`

## 5. Evidence pointers

- Real-world proof: `packages/orchestrator-langgraph/src/__tests__/real-world.test.ts` — real Chromium crawled the real `reference-auth-app`; a dual-evidence login candidate used no injected `compile` option, produced `compiled:true` with a defined `stagedBundle`, and stage 10 received that same staged result.
- Artifacts: generated full compiler files in the test's ephemeral run output; no retained screenshot or raw trace was added because this proof tests compile/stage handoff rather than asserting UI success.
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (104 files / 898 tests passing) ☑ · license gate (782 total / 780 allowed / 2 excepted / 0 rejected) ☑

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                             | Expected disposition                                                                                                         | Test                                                                                                          |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Inference yields no workflow candidate                                              | `observed`; `compiled:false` with the preserved no-candidate plan                                                            | `sad-paths.test.ts` — `finishes partially with observed empty coverage when inference yields zero candidates` |
| Candidate reaches the full compiler without required source/runtime observations    | `blocked`; structured compiler diagnostic is returned as `compiled:false` and the run proceeds without an uncaught exception | `sad-paths.test.ts` — `classifies a full-compiler evidence rejection as blocked without throwing`             |
| Unsupported assertion intent or mismatched source commit reaches the full generator | `blocked`; full compiler rejects rather than rendering a loose catch-all assertion                                           | Compiler policy/validation suites plus the same stage-9 throw adapter exercised by the missing-evidence test  |
