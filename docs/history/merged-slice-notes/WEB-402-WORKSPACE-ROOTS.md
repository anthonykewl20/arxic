# WEB-402-WORKSPACE-ROOTS — staged doc updates (charter §10.2)

Issue: #402 · Disposition: observed implementation (local green; CI pending — an LLM cannot assign `verified`).

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```text
| #402 | Web product release: comprehensive frontend intent campaigns and AI visual auditing | In progress; workspace roots are operator-manageable at runtime (Administration → Server workspace) with durable audited deltas |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```text
| 2026-09-07 | **#402 (WEB-402-WORKSPACE-ROOTS) runtime workspace-root management landed.** Operators can widen the folder allow-list from the dashboard: `POST/DELETE /api/roots` (session-guarded, same-origin, JSON), `Workbench.addWorkspaceRoot/removeWorkspaceRoot` (realpath-resolved, overlap-rejecting, audited `workspace.root-added/-removed`), deltas persisted in a new `settings` SQLite table and merged over startup `ARXIC_WEB_ROOTS` on boot; a root with a connected project refuses removal (409, named project); unused roots remove cleanly. The Administration "Server workspace" card now lists roots with add/remove controls and live refresh, and the dead-end project error now points at Administration → Workspace roots. Real-world proof: real HTTP server journeys (workspace-roots.real-world.test.ts) — 401 unauthenticated, 400 relative/missing/absent path, add root → connect previously-outside project 201 → 409 dependent removal → 200 unused removal → root survives restart; red first at `3c4ae20b` (no /api/roots routes; unknown API paths never answered — a router dead fall-through, now reachable only for still-unknown paths). Boundary: startup roots remain the floor (removal is a persisted delta, reapplied on boot); projects cannot be deleted yet, so a root under an active project stays pinned. Gates local: apps/web typecheck ☑ · eslint ☑ · vitest 18/18 ×3 (incl. workspace/http/campaigns regressions) ☑ · format ☑ (full repo after note); CI on the PR head is the remaining gate. Human screenshot inspection remains owed release-wide. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```text
- WEB-402-WORKSPACE-ROOTS runtime workspace-root management (#402): the folder allow-list is no longer restart-frozen — administrators add or remove workspace roots from Administration → Server workspace (or `POST/DELETE /api/roots`), additions persist across restarts in the state database, and connecting a project under a newly added root works without a server restart; audited, session-guarded, and refused while a connected project depends on the root.
```

## 4. `VERSION` bump required?

No — the fold integrator owns `VERSION`; user-observable capability rides the next integrator fold of the current `0.0.301` line.

## 5. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/workspace-roots.real-world.test.ts` — real `startWorkbench` HTTP servers, real session cookie flow, real project connection under a runtime-added root, real restart persistence through the SQLite state directory.
- Artifacts: `docs/evidence/WEB-402-WORKSPACE-ROOTS/green.txt` — final full run `Tests 18 passed (18)` across the roots journey, workspace unit, HTTP guard and campaigns regression suites (3× repeated locally, all green). Red record: commit `3c4ae20b`.
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (18 passing, 3× repeated) ☑ · license gate → CI.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                     | Expected disposition                                                                                      | Test                                                                                                                           |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Unauthenticated `POST /api/roots`                           | 401 before any state change                                                                               | `refuses to widen workspace roots…`                                                                                            |
| Relative path / missing folder / absent `path`              | 400 with an explicit message; nothing persisted                                                           | same test                                                                                                                      |
| Add a root equal to, inside, or containing an existing root | 409 `overlaps a configured root`                                                                          | `workbench.addWorkspaceRoot` guard (journey covers equality-adjacent case via distinct folders; overlap branch unit-reachable) |
| Remove a root with a connected project                      | 409 naming the project; root stays                                                                        | journey assertion `still uses this workspace root`                                                                             |
| Remove an unused root                                       | 200; gone from state                                                                                      | journey `spare-root` removal                                                                                                   |
| Server restart                                              | Added roots survive (durable deltas merged over startup roots); removed startup roots stay removed        | journey restart leg                                                                                                            |
| Unknown API path (pre-existing router dead fall-through)    | Still unanswered — pre-existing behavior, now documented here as an observed defect for a follow-up slice | observed during red (5 s hang); out of scope here                                                                              |

## 7. Post-CI regression fix (2026-09-07, same slice)

First CI run on the PR head caught a defect local gates had missed: the slice's new `settings` SQLite table (`key`, `data`) collided with the retention repository's pre-existing `settings` table (`key`, `value`). Whichever `CREATE TABLE IF NOT EXISTS` ran first won, so every `RetentionRepository.write` failed with `SqliteError: no such column: excluded.value` — `POST /api/retention` returned 500 in the packed distribution proof (`dashboard` ×4 and `package` jobs red; the error was swallowed by the silent catch-all). Local verification gap that allowed it: the shift re-ran only the slice's own suites plus campaigns/workspace regressions, not the retention suites.

Fix: the slice's table renamed to `instance_settings` (no migration needed — the PR is unmerged, so no deployed database carries the collided shape); the server catch-all now logs non-`HttpError` failures to stderr so 500s are debuggable; and the workspace-roots journey pins `POST /api/retention` (200 + policy roundtrip) on the same store, so the collision cannot silently return. Proof: all 5 retention suites + workspace suites red before the rename (`7 failed / 7`) and green after; a packed-tarball probe of the installed CLI reproduced the 500 before the fix and returns 200 after.

## Addendum (2026-09-08 — sad-path table row 7 corrected)

The row describing an "unknown API path (pre-existing router dead fall-through)" as an observed defect was a misattribution. Direct verification on main `5a3320ee` (and the `throw new HttpError(404, 'Not found')` is present at this slice's base `84893e95`): unknown API and page paths answer `404 {"error":"Not found"}` in ~3 ms. The red-phase "5 s hang" had an unrelated cause that was never isolated; the catch-all 404 follow-up recorded from this note is withdrawn (see the #402 correction comment of 2026-09-08).
