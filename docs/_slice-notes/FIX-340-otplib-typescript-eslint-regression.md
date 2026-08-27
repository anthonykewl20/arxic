# FIX-340 — staged doc updates (charter §10.2)

Issue: #340 · PR: #342 · Disposition: verified

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #340 | [FIX-340] otplib/typescript-eslint dependency-bump regression fixed | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-28 | **#340 (FIX-340) otplib/typescript-eslint dependency-bump regression DONE.** PR #328's dependabot bump merged without CI (its last CI run had failed) broke main two ways: (1) otplib 12.0.1 -> 13.5.0 dropped the `authenticator` export in a full API rewrite, breaking `reference-auth-app`'s real MFA build (production code, not just the test harness) and cascading into 4 orchestrator-langgraph real-world suite failures plus one downstream `afterAll` teardown crash (confirmed to be a symptom, not an independent bug — it self-resolved once the build broke was fixed); (2) typescript 5.6.0 -> 7.0.2 is unsupported by typescript-eslint@8.67.0 (peer range `<6.1.0`, open upstream issue #10940), crashing `pnpm lint` on every branch off main. Fix: pinned `otplib` to `^12.0.1` and `typescript` to `^5.6.0` in the affected package.json files (comments added at each otplib import site), plus fixed 12 real `no-useless-assignment`/`preserve-caught-error` violations that surfaced once lint could execute again. Left `next`/`eslint`/`@eslint/js`/`vitest`/`@langchain/*` at their #328-bumped versions (verified compatible). Gates: lint 0 errors, typecheck 0 errors (31/31 workspace projects), format clean, orchestrator-langgraph 220/220 passing, reference-auth-app `next build && vitest run` 3/3 passing, fixture-otplib+fixture-mailpit 10/10 passing. Merged with `--admin` (no CI available — Actions minutes exhausted, resets in ~5 days). **M<x> <n>/<total>.** Next: #<next>. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-340 Fix otplib/typescript-eslint regression from PR #328 (#340): pin `otplib` to `^12.0.1` (13.x dropped the `authenticator` export used by `reference-auth-app`'s MFA flow and the otplib fixtures) and `typescript` to `^5.6.0` (7.0.2 crashes `typescript-eslint@8.67.0`, which has no release supporting TS 7.x yet); also fixes 12 real lint violations (`no-useless-assignment`, `preserve-caught-error`) that PR #328's eslint bump surfaced but could never run because of the crash.
```

## 4. `VERSION` bump required?

no — this is a regression fix restoring main to its previously-working, already-released dependency baseline; no new user-observable capability per RELEASES.md.

## 5. Evidence pointers

- Real-world proof: `packages/orchestrator-langgraph/src/__tests__/{real-world,inference-real-world,exploration-real-world,intent-proof.real-world}.test.ts` — real Next.js/Turbopack build + boot of `test-fixtures/reference-auth-app`, real LangGraph orchestration, real ast-grep/Tree-sitter evidence, all 220 tests passing post-fix (0 before: 4 suites failed at setup on otplib's Turbopack build break).
- `test-fixtures/reference-auth-app`: `pnpm --filter reference-auth-app test` (`next build && vitest run`) — real Turbopack production build of the MFA enroll/challenge routes that import `otplib` directly, 3/3 tests passing.
- `packages/fixture-otplib`, `packages/fixture-mailpit`: 10/10 tests passing against the real otplib 12.0.1 API.
- Artifacts: none (dependency/lint fix, no new screenshots/traces).
- Gates: typecheck ☑ (31/31 workspace projects, 0 errors) · lint ☑ (0 errors) · format ☑ (`pnpm format:check` clean) · test (230 total: 220 orchestrator-langgraph + 3 reference-auth-app + 10 fixture-otplib/fixture-mailpit, all passing) ☑ · license gate ☐ (not run — out of scope for this fix; no license-relevant dependency changed).

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                                                       | Expected disposition                                                                        | Test                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `reference-auth-app` MFA enroll/challenge server actions import `otplib`'s `authenticator`                                    | build succeeds (blocked before fix: Turbopack `Export authenticator doesn't exist`)         | `pnpm --filter reference-auth-app test` (`next build` step)                  |
| orchestrator-langgraph real-world suites boot `reference-auth-app` in `beforeAll`                                             | suite runs to completion, `afterAll` teardown does not crash on an unassigned `modelServer` | `packages/orchestrator-langgraph/src/__tests__/inference-real-world.test.ts` |
| `pnpm lint` invoked on a branch off current `main`                                                                            | exits 0, no typescript-eslint peer-dependency crash                                         | `pnpm lint`                                                                  |
| dead default initializers ahead of unconditional try/catch reassignment (e.g. `git.ts` `commit`, `attestation.ts` `hostname`) | flagged and removed, not suppressed                                                         | `pnpm lint` (`no-useless-assignment`)                                        |
| rethrown errors that swallow the original cause (e.g. `runner.ts`, `tarball-smoke.mjs`)                                       | rethrow carries `{ cause: error }`                                                          | `pnpm lint` (`preserve-caught-error`)                                        |
