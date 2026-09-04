# FIX-395-compiler-staging-isolation — staged doc updates (charter §10.2)

Issue: #395 · PR: (this PR) · Disposition: verified

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #395 | [gate-finding] compiler real-world proof stages its suite INSIDE the repo under evaluation — CI explodes once real evidence lands under docs/evidence | ☑ done — staged output relocated to the OS tmpdir; no assertion weakened; the in-repo coupling removed |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-05 (3) | **#395 (FIX-395-compiler-staging-isolation) staged-suite isolation DONE.** The compiler real-world proof staged its generated suite at `<repo>/.arxic-compiler-output-*` (INSIDE the tree under evaluation); with the DG-12 exit evidence present, the staged real-CLI run died deterministically on CI (`test (3/4)`, three runs: `RangeError: Invalid string length` inside playwright-core's spawnAsync socket accumulation, >512MB in <4s) while never reproducing locally (source worktree, fresh clone, fully-installed fresh clone + CI=true + Mailpit). Relocated staging to `mkdtemp(join(tmpdir(), …))` — every leak vector (config fallback walks, workspace discovery, test discovery) exists only via the in-repo location; the proof's assertions (real-CLI `--list` discovery + real `1 passed` run against the booted fixture app) are unchanged and disclosed as such. Compiler suite 2/2; typecheck/lint/format green. Next: #392 re-runs CI with the full evidence tree. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-395 compiler real-world proof stages outside the repo (#395): the generated verification suite now stages under the OS temporary directory instead of `<repo>/.arxic-compiler-output-*`, removing the staged run's coupling to repository content (config fallback, workspace and test discovery); proof assertions unchanged.
```

## 4. `VERSION` bump required?

no — test-only relocation; no published-surface change

## 5. Evidence pointers

- Real-world proof: `packages/playwright-compiler/src/real-world.test.ts` — still stages, discovers via the real Playwright CLI (`--list` contains the workflow id), and runs the suite for real against the booted fixture app (`1 passed`); the repo root stays free of staging dirs (verified)
- The observed red state: PR #392 CI runs 33903162590 / 33907330028 / 33911124122 (`test (3/4)`, `RangeError: Invalid string length`)
- Gates: compiler suite 2/2 · typecheck ✓ · lint ✓ · full-repo `format:check` ✓

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                 | Expected disposition                                                     | Evidence                         |
| --------------------------------------- | ------------------------------------------------------------------------ | -------------------------------- |
| staged suite created during the test    | lives under the OS tmpdir; no `.arxic-compiler-output-*` inside the repo | post-run repo-root check (clean) |
| real-CLI discovery                      | `--list` output contains the workflow id (unchanged assertion)           | test green 2/2                   |
| real run                                | `1 passed` against the booted fixture app (unchanged assertion)          | test green 2/2                   |
| CI with the DG-12 evidence tree present | `test (3/4)` passes (discharged by #392's re-run after this merges)      | PR #392 re-run                   |
