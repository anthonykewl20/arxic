# POLL-WINDOW-525 — staged doc updates (charter §10.2)

Issue: #525 · PR: <to-fill> · Disposition: observed (remedy 1's red is reproduced CI evidence on identical content; remedy 2's red is observed missing-artifact lists; the underlying suite-duration growth is deliberately left to remedy 3)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #525 | [POLL-WINDOW-525] navigation-bridging polls outlive the 1s default; journal uploads on failure | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-09 | **#525 (POLL-WINDOW-525) remedies 1+2 DONE.** All five navigation-bridging URL polls in real-world journeys (`baseline-history-ui`, `capture-write-isolation`, `capture-failures`, `capture-gallery-ui`, `visual-density-ui`) carry an explicit 30s timeout — vitest's 1s default tripped in the unsharded release-test ubuntu cells (capture-gallery light+dark failed at 3.1s/6.6s, reproduced 2/2 on two heads, runs 34245658145 + 34276464363, while windows/macos and sharded ci passed identical content); assertions unchanged. The `package` job's packed-human-flow-evidence upload now runs `if: always()` so a failed packed phase publishes its progress journal (both prior failed runs lost it). Local green: 5 files / 10 journeys with real Chromium/Firefox/WebKit. Remedy 3 (release-test 25m ubuntu cell cap; full unsharded `pnpm test`) and remedy 4 (packed phase 900s cap) remain open on #525. **M<next> <n>/<total>.** Next: #525 remedy 3 after soak. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- POLL-WINDOW-525 release-path diagnostics (#525, #<PR>): every navigation-bridging URL poll in the real-world dashboard journeys carries an explicit 30s timeout instead of vitest's 1s default, which tripped under the unsharded release-test ubuntu cells (reproduced 2/2 across two heads while windows/macos and the sharded `ci` matrix passed identical content); and the `package` job now uploads the packed human-flow evidence with `if: always()`, so a failed packed phase preserves its per-case progress journal instead of dying with the runner.
```

## 4. `VERSION` bump required?

no — test timing robustness plus CI evidence retention; no user-observable product change

## 5. Evidence pointers

- Real-world proof (green): all five touched journey files with real Chromium/Firefox/WebKit — `Test Files 5 passed (5) · Tests 10 passed (10)` — `docs/evidence/WEB-525-POLL-WINDOW/green-local-five-journeys.txt`
- Red (remedy 1): release-test ubuntu cells failing capture-gallery light+dark at 3.1s/3.1s (run 34245658145) and 2 failed 6579ms (run 34276464363, full unsharded `pnpm test` step) on identical content that passed on windows/macos and sharded ci — `docs/evidence/WEB-525-POLL-WINDOW/red-release-ubuntu.txt`
- Red (remedy 2): `packed-human-flow-evidence` absent from the artifact lists of failed runs 34271337618 and 34276464364 (only `web-dashboard-*` / `installed-dashboard-*` present); phase summaries alone survived
- Gates: typecheck ✓ · lint ✓ · format ✓ (`All matched files use Prettier code style!`) · targeted suites 10/10 ✓ · full suite in CI

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                   | Expected disposition                                                             | Test                                                                                           |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Enqueue POST round-trip exceeds 1s under unsharded load                   | Journey proceeds until the run id appears (≤30s), never a premature poll failure | capture-gallery + four sibling journeys, explicit `timeout: 30_000`                            |
| Packed phase fails at its cap or exits 1                                  | Per-case progress journal uploads with the run's evidence (`if: always()`)       | ci.yml step change; next failed phase publishes (observed gap on runs 34271337618/34276464364) |
| Upload step runs with no evidence directory (job failed before the phase) | `if-no-files-found: ignore` keeps the upload step from failing the job           | ci.yml step change                                                                             |
