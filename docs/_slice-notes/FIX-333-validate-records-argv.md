# FIX-333-validate-records-argv — staged doc updates (charter §10.2)

Issue: #333 · PR: #TBD · Disposition: verified

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #333 | [FIX-333-validate-records-argv] validate-records.ts drops the directory positional when --live-key-env is absent | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-27 | **#333 (FIX-333-validate-records-argv) validate-records.ts argv off-by-one DONE.** Replaced index-arithmetic positional filter (`index !== liveKeyEnvIndex + 1`, which dropped index 0 whenever `--live-key-env` was absent since `indexOf` returns `-1`) with a left-to-right token-consuming parser (`parseValidateRecordsArgs`) that resolves flags and the directory positional in any order without special-casing `--live-key-env`. Proved with a real `tsx` subprocess invocation (no mocks) against a temp evidence directory for: single-flag invocation (directory + `--allow-missing-live-key`, no `--live-key-env` — the reported bug), the existing `--live-key-env`-present workaround (directory-first and flags-first orderings). 92/92 package tests pass, typecheck clean, lint clean. **M? ?/?.** Next: #TBD. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-333-validate-records-argv (#333): fix `validate-records.ts` argv parsing so the evidence-directory positional is retained when `--live-key-env` is not supplied — previously an `indexOf('--live-key-env') === -1` off-by-one caused the filter to always drop index 0, forcing a `--live-key-env <var>` workaround for every invocation. The new parser consumes flags and positionals left-to-right in any order and no longer special-cases `--live-key-env`.
```

## 4. `VERSION` bump required?

yes → 0.1.2 (packages/intent-proposal-spike), because the CLI's argv-handling behavior is user-observable per RELEASES.md (the script now works without the previously-required `--live-key-env` workaround).

## 5. Evidence pointers

- Real-world proof: `packages/intent-proposal-spike/scripts/__tests__/validate-records-argv.test.ts` — spawns the actual script as a real `tsx` child process (via `pnpm --filter @arxic/worker exec tsx`, the documented invocation) against a real temporary evidence directory (no mocked fs, no mocked argv parsing) for three orderings: directory + `--allow-missing-live-key` only (no `--live-key-env` — the reported bug), directory + `--live-key-env VAR` + `--allow-missing-live-key` (workaround order), and `--live-key-env VAR` + `--allow-missing-live-key` + directory (flags-first order). All three assert the script's JSON stdout resolves the correct `directory` and scans it (`records: 0` on the empty temp dir, i.e. it did not exit 2 with the usage banner).
- Also unit-level: 6 pure `parseValidateRecordsArgs` cases (sad-path-first) covering absent-flag, flag-with-no-value, and every ordering combination.
- Artifacts: none (no UI surface; CLI stdout/exit-code proof is inline in the test file above).
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (92 passing in packages/intent-proposal-spike) ☑ · license gate (not run in worktree; CI-only) ☐

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                               | Expected disposition                                                             | Test                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Directory positional + `--allow-missing-live-key`, no `--live-key-env` (the reported bug)             | verified — directory resolved, scan proceeds, exit 0                             | `validate-records-argv.test.ts` → "sad path: scans the directory when only --allow-missing-live-key is passed" (real subprocess) + "sad path: resolves the directory positional when --live-key-env is absent" (unit) |
| Directory positional alone, no flags at all                                                           | verified — directory resolved                                                    | `validate-records-argv.test.ts` → "directory positional survives even as the only argument"                                                                                                                           |
| `--live-key-env VAR` present with no following value (flag at end of argv)                            | verified — flag recorded as present with empty value; does not eat the directory | `validate-records-argv.test.ts` → "treats a --live-key-env with no following value as present but empty"                                                                                                              |
| `--live-key-env`/`--allow-missing-live-key` preceding the directory positional (flags-first ordering) | verified — directory still resolved, order-independent                           | `validate-records-argv.test.ts` → "resolves the directory when flags precede the positional" + real-subprocess "still works with --live-key-env preceding the directory positional"                                   |
| Existing `--live-key-env`-present workaround, directory-first ordering (must not regress)             | verified — directory still resolved, live-key scan still runs                    | `validate-records-argv.test.ts` → "resolves the directory when --live-key-env VAR precedes it" + real-subprocess "still works with the --live-key-env workaround present"                                             |
