# DG-297-surface-tier — staged doc updates (charter §10.2)

Issue: #297 (E1 + E3 slices) · PR: #TBD · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the row for #297 verbatim)

```
| #297 | [DG-297] runtime surface tier: placeholder/hydration-aware crawl + surface-aware compile selection (E1+E3; unblocks DG-12 replays) | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-24 | **#297 (DG-297) E1+E3 DONE (slice 1 of 2).** F-E remediation, first half: the crawler's control labeling is now label-first with a placeholder fallback and treats a literal `aria-label="undefined"/"null"` as an upstream binding artifact (koel shape), and every crawled URL waits bounded (hydrationSettleMs, default 2500ms) for a form to attach before probing — the two defects that left BOTH ratified DG-12 targets' runtime crawl tiers at 1 route / 0 forms. The compile lane now selects the first candidate whose cited row's route HAS a crawl form surface (selectCompilableCandidate) instead of blocking whole runs on candidates[0] (F-E: directus blocked on /addons/:param, koel on an API path); when nothing resolves, candidates[0] still flows onward for the honest SURFACE-MISSING report. 3 red-first real-Chromium/real-HTTP tests for the crawl (hydration-delayed placeholder-only form, koel "undefined"-aria shape, label-beats-placeholder precedence) + 4 red-first selection tests; regression 225 (crawler+orchestrator) + 129 (CLI). E2 (authenticated crawl via replayPersona) remains open on #297. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- DG-297 runtime surface tier (#297, E1+E3): the crawl tier now inventories hydration-delayed SPA forms (bounded per-URL form-attach wait, `hydrationSettleMs` on CrawleeSurfaceDiscoverer, default 2500ms) and derives control labels label-first with a placeholder fallback (a literal `aria-label="undefined"`/`"null"` is treated as an upstream binding artifact, not a label) — previously both ratified DG-12 targets crawled to 1 route / 0 forms, structurally zeroing every replay. The proposal compile lane selects the first candidate whose cited row's route has a resolvable crawl form surface (`selectCompilableCandidate`) instead of blocking the whole run on `candidates[0]`; when no candidate resolves, `candidates[0]` flows onward so `ARXIC-ORCH-PROPOSAL-SURFACE-MISSING` is still reported honestly.
```

## 4. VERSION bump required?

no — internal adapter option + orchestrator-internal selection; no config schema, diagnostic code, or public CLI surface changed. `docs/configuration.md` gains the crawl-tier labeling semantics paragraph.

## 5. Evidence pointers

- Red→green, E1: `packages/crawlee-adapter/src/__tests__/hydration-placeholder.real-world.test.ts` — real Chromium through the REAL adapter against real HTTP servers shaped like the observed target markup (700ms hydration-delayed placeholder-only form; koel `aria-label="undefined"` + placeholder shape; label-beats-placeholder precedence). All 3 failed before the change (0 forms / dropped fields), pass after.
- Red→green, E3: `packages/orchestrator-langgraph/src/__tests__/proposal-compile.test.ts` (`DG-297 E3` describe) — first-candidate-surface-less selection, honest fallback when nothing resolves, no-candidates, orphan-candidate skip. All 4 failed (`selectCompilableCandidate is not a function`) before, pass after.
- Regression: `packages/crawlee-adapter` + `packages/orchestrator-langgraph` 225/225; `apps/cli` 129/129; `pnpm typecheck` clean.
- The motivating OBSERVED evidence is campaign round 1 (F-E, #256 issuecomment-5395828801): both targets' `artifacts/05.json` recorded 1 route / 0 forms; stage 9 blocked `ARXIC-ORCH-PROPOSAL-SURFACE-MISSING` on `candidates[0]`'s route.

## 6. Sad paths proved

| Trigger                                                    | Expected disposition                                     | Test      |
| ---------------------------------------------------------- | -------------------------------------------------------- | --------- |
| Form renders only post-hydration (700ms)                   | crawl waits bounded, form inventoried                    | E1 test 1 |
| `aria-label="undefined"` + placeholder (koel)              | placeholder is the label; artifact string ignored        | E1 test 2 |
| `<label>` AND placeholder present                          | label wins (precedence preserved)                        | E1 test 3 |
| `candidates[0]` has no crawl surface, later candidate does | later candidate compiled; run not blocked                | E3 test 1 |
| NO candidate resolves                                      | candidates[0] flows onward; SURFACE-MISSING stays honest | E3 test 2 |
| Zero candidates                                            | selection undefined (prior behavior)                     | E3 test 3 |
| Candidate without proposal/row                             | skipped, nothing invented                                | E3 test 4 |

## 7. What was NOT done (reporting discipline)

- **E2 (authenticated crawl via `fixtures.replayPersona`) is NOT in this slice** — it needs a storageState bridge from the verifier's login machinery into the crawler's browser contexts and a credentials-flow decision; claimed as slice 2 on #297. Until E2 lands, auth-gated SPAs still expose only their login view to the crawl, so the surface map gains the login form (E1) but not the authenticated interior.
- The DG-12 campaign re-run is deliberately NOT attempted with E1+E3 alone (acceptance criterion 5 requires it after ALL of E1-E3); spend stays frozen.
- `hydrationSettleMs` defaults to 2500ms without per-target tuning; form-less pages pay the settle once per URL (bounded by maxUrls). No measurement of crawl latency impact was recorded beyond the test suite runtimes.
- G-3 grounded-ratio semantics (scan-diagnostic rows, wildcard routes in the denominator) remain owner-triage on #256 F-E — untouched here.
