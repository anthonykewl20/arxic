# CAPTURE-CAUSE-502 — staged doc updates (charter §10.2)

Issue: #502 · PR: <to-fill> · Disposition: observed (red→green demonstrated on both journeys with a real engine and real browser; the underlying environment transient itself is not eliminated)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #502 | [CAPTURE-CAUSE-502] journey setup runs name the engine's cause | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-08 | **#502 (CAPTURE-CAUSE-502) journey setup runs name the engine's cause DONE.** The two journeys behind the issue's original `expected undefined to be 'changed'` and `first visual run produced no captures` CI signatures (changed-regions-ui, diff-viewer-ui) now read setup-run outcome through a shared `requireCompletedRun` helper: a non-completed run fails the journey with terminal state + engine summary + per-finding reasons (the #515 fields). Red→green with a deterministic accept-and-destroy socket on unmodified code (opaque message captured), then the same sabotage yields `first visual run ended blocked: … — page.goto: net::ERR_SOCKET_NOT_CONNECTED at …`; clean 2/2 with real Chromium against the reference vulnerable-auth fixture. Truth state: observed; the transient itself is not eliminated — every future occurrence is now self-identifying. **M<next> <n>/<total>.** Next: #402 runtime/worker/retention controls. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- CAPTURE-CAUSE-502 journey setup runs name the engine's cause (#<PR>): `changed-regions-ui` and `diff-viewer-ui` real-world journeys read their setup visual runs through a shared `requireCompletedRun` helper, so a blocked or cancelled run fails the journey with the terminal state, the engine summary and the retained per-finding reasons instead of the cause-free "produced no captures" / `expected undefined to be 'changed'` assertions. Proven red→green against a deterministic accept-and-destroy socket with real Chromium (`docs/evidence/WEB-502-CAPTURE-CAUSE/`), clean 2/2 on the untouched paths.
```

## 4. `VERSION` bump required?

no — test-only diagnosability hardening; no user-observable product change (per RELEASES.md)

## 5. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/changed-regions-ui.real-world.test.ts` + `apps/web/src/__tests__/diff-viewer-ui.real-world.test.ts` — real Chromium (Playwright webkit-style dashboard launcher) against the reference `vulnerableAuthApp` fixture through the workbench's real `Workbench.open`/`enqueue`/`idle` path
- RED (unmodified journeys, sabotaged origin): `docs/evidence/WEB-502-CAPTURE-CAUSE/red-changed-regions.txt`, `red-diff-viewer.txt` — both fail `Error: first visual run produced no captures` with no cause
- GREEN sad path (hardened journeys, same sabotage): `green-changed-regions.txt`, `green-diff-viewer.txt` — both fail `first visual run ended blocked: 0 viewport checkpoints captured across 1 pages. … — page.goto: net::ERR_SOCKET_NOT_CONNECTED at http://127.0.0.1:<port>/`
- GREEN clean path (sabotage removed, hardening kept): `green-clean-run.txt` — `Test Files  2 passed (2) · Tests  2 passed (2)`
- Gates: typecheck ✓ (`tsc -p tsconfig.json --noEmit` clean) · lint (primary tree, pre-PR) · format ✓ (`All matched files use Prettier code style!`) · test: targeted suites above; full suite in CI

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                     | Expected disposition                                                                              | Test                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Setup visual run ends `blocked` (transient navigation failure, dead origin) | Journey fails naming state + engine summary + finding reason, never a bare "produced no captures" | changed-regions/diff-viewer sabotage runs (red→green evidence) |
| Setup visual run ends `cancelled` or the store returns no run               | Same cause-bearing failure via `requireCompletedRun` (`ended cancelled: …` / `ended unknown: …`)  | helper branch; same journeys                                   |
| Completed setup run with zero captures (genuine product defect)             | Original capture assertion still fires (`completed without captures`), no loosening               | residual branch kept in both journeys                          |
