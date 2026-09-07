# WEB-435-DISTRIBUTION — staged doc updates

Issue: #435 · PR: linked from issue · Disposition: observed scoped local proof;
required current-head CI is recorded in the PR before merge. #402 remains open.

## 1. `docs/SYNC.md` — tracker row

Fold after the required CI gate passes and this slice merges:

```
| #435 | [WEB-435-DISTRIBUTION] Installed web dashboard, compiled jobs and recovery proof | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row

```
| 2026-09-07 | **#435 (WEB-435-DISTRIBUTION)** packaged `arxic web`, prebuilt frontend and compiled jobs; startup integrity/config gates; shared source/installed browser assertions. Actual clean-install CLI + dashboard pipeline passed locally in 269.77 s, including five installed-server tests. 103 agent-viewed PNGs, four hash-checked sanitized timelines, 95 axe/reflow reports with zero violations/incomplete/overflow. Required current-head CI is recorded in the PR/issue. Full #402 and human release inspection remain open. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### Added`

```
- WEB-435-DISTRIBUTION (refs #435): add installed `arxic web` with prebuilt dashboard and compiled isolated jobs; validate asset/job integrity and absolute roots before readiness. Extend the clean-install gate through real dashboard discovery, visual/baseline/element inspection, functional campaigns and restart/deletion/queued-run recovery. Source development remains available. No registry release performed.
```

## 4. `VERSION` bump required?

Yes, user-observable installed command. Integrator selects the next synchronized
`VERSION`/package version while folding deferred notes; this worktree does not edit
the shared global files. Current package/dashboard version remains 0.0.200.

## 5. Evidence pointers

- [Safe proof](../evidence/WEB-435-DISTRIBUTION/summary.md), package identity and pipeline phases.
- Public seams: `scripts/web-distribution-e2e.mjs`, `scripts/human-flow-e2e.mjs`, web UI/dashboard/campaign/restart real-world tests.
- Local: root/package typechecks, lint and license pass (808 packages, zero rejected); 16 CLI and 17 packaging helper assertions pass; source HTTP 4 pass; actual packed pipeline pass.
- Full-repo format is run after this note. Exact final output and required current-head CI are recorded in the PR/issue completion report.
- All 103 screenshots reviewed in contact sheets, representative overview/comparison originals reviewed separately; four timelines and every PNG hash independently checked. Human release inspection remains outstanding.

## 6. Sad paths proved

| Trigger                                                                     | Expected disposition                                                       | Test                     |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------ |
| Missing credentials, assets/job corruption, relative roots or unsafe origin | Observed startup refusal before readiness                                  | Installed command script |
| Invalid login, stale response, unavailable history/geometry                 | Observed refusal/retry; no fabricated trusted geometry or restored session | UI/dashboard tests       |
| Storage failure during authorized deletion                                  | Observed explicit 409, durable intent, recovery after restart              | Public API restart test  |
| Interrupted run and queued work                                             | Blocked interrupted result; queued work executes after restart             | Public API restart test  |
| Invalid password/unreachable target                                         | Blocked or contradicted engine result; prior promoted evidence preserved   | Packed CLI human flow    |

Deferrals: human release inspection/publication, broad browser/persona/state matrix,
heuristic completeness and #402's runtime-management gaps. A newly written recovery
assertion was corrected from 500 to the existing exact 409 cleanup-retry contract;
its evidence-preservation assertions were not loosened.
