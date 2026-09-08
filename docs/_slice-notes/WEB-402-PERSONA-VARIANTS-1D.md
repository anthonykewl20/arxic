# WEB-402-PERSONA-VARIANTS-1D — staged doc updates (charter §10.2)

Issue: #402 · PR: <to-fill> · Disposition: mixed (capability verified at the engine-config boundary; live-model divergence remains the paid-inference gap)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #402 | [WEB-402-PERSONA-VARIANTS-1D] distinct-login-path persona variants | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-09 (9) | **#402 (WEB-402-PERSONA-VARIANTS-1D) distinct-login-path persona variants DONE.** Persona variant entries gain an optional NON-SECRET login override `{ route, emailLabel?, passwordLabel?, submitLabel? }` (credentials stay env-only); `variantScopePayload` stamps `workflowScope.variantLogin` at all three fan-out sites (enqueue, recurring fire, drift rebind — free via the shared helper); the child's `variantExecution` merges route + present labels over the project persona through the ONE unchanged `executionConfig(...)` path, so real `runs/<id>/engine-config.json` snapshots diverge per variant. The reference-auth-app fixture gains a real second login route `/login/alternate` (Work email / Passphrase / Sign in, same `login` server action + CSRF) — ADDITIVE only, no pinned file touched; the variants editor exposes route + three labels on persona rows. Proven red-first (5/5 red before the fixture/helper existed) with real reference-auth-app journeys: seeded-user auth through `/login/alternate` in real Chromium, distinct-path fan-out + engine-config divergence, the validation matrix through the real API, recurring fire + real-git-drift rebind stamping, and a real Chromium dialog save of the override through the real API; 5 slice tests + 46 regression tests green. Distinct-identity AC2 proof still rides the paid-inference gap. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- WEB-402-PERSONA-VARIANTS-1D distinct-login-path persona variants (#402, PR <to-fill>): persona campaign variants may declare an optional non-secret login override (route + email/password/submit labels, validated sad-path-first with distinct 400s); the override is stamped as `workflowScope.variantLogin` at the enqueue, recurring-fire and drift-rebind fan-outs, merged over the project persona in the child's single validated `executionConfig` path, and proven by diverging real `runs/<id>/engine-config.json` snapshots plus a real seeded-user login through the new `/login/alternate` fixture route in real Chromium.
```

## 4. `VERSION` bump required?

No — rides the open #402 scope (fold precedent: #471/#492/#494/#498; the capability is part of the unreleased web-product work, not a standalone release).

## 5. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/persona-variants-1d.real-world.test.ts` — real `reference-auth-app` checkout (source-ua testkit repo) through `Workbench.open`/`wb.tick`, the real built fixture app (`bootFixtureApp`, ephemeral `freePort`), and real Chromium (`launchDashboardBrowser`, `startWorkbench({ port: 0 })`). Mailpit env left unset; per-run `mkdtemp` state directories.
- Artifacts: `docs/evidence/WEB-402-PERSONA-VARIANTS-1D/red.txt` (verbatim 5/5 red before implementation), `docs/evidence/WEB-402-PERSONA-VARIANTS-1D/green.txt` (two consecutive full-green runs of the suite).
- Gates: typecheck ☑ · lint ☑ (`pnpm lint` from the primary root, clean) · test ☑ (5 slice tests green twice consecutively; regressions 46 green: persona-variants 20, persona-variants-ui 1, drift-rebind, drift-revalidate, workspace 5, campaigns unit, inventory-ledger-ui, source-ua-adapter real-world) · format ☑ (see PR body for the verbatim last line) · license gate — runs in CI, not run locally.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                            | Expected disposition                                                                                                            | Test                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `login.route` without a leading `/` (e.g. `login`) | 400 `A variant login route must start with /`, zero runs enqueued                                                               | `rejects every invalid variant login override…` case 1 |
| `login` present with no `route`                    | 400 `A variant login override requires a route`                                                                                 | case 2                                                 |
| Empty-string login label                           | 400 `Variant login labels must be short non-empty text`                                                                         | case 3                                                 |
| Login label >100 chars                             | 400 same shared message                                                                                                         | case 4                                                 |
| `login` payload on a flag entry                    | 400 existing foreign-payload `Campaign variants must be a list of variant definitions`                                          | case 5                                                 |
| `login` payload on a state entry                   | 400 same existing foreign-payload message                                                                                       | case 6                                                 |
| Persona variant without the override               | Run inherits the project login surface (`engine-config` route + project labels; no `variantLogin` on scope)                     | fan-out journey, runs default/A                        |
| Login override on a persona variant                | `workflowScope.variantLogin` stamped on the run; child `engine-config.json` `fixtures.replayPersona.login` swaps route + labels | fan-out journey run B; recurring/rebind journey        |
| No live model                                      | Runs end `blocked` — divergence proven at the engine-config boundary, never faked                                               | fan-out journey (established #495)                     |

Known gaps (honest): divergence is proven at the engine-config boundary only (no live model in this environment); the UI exposes exactly one login override per persona row with blank labels meaning "keep project value" (the API accepts partial overrides); the distinct-authenticated-identity AC2 proof still rides the paid-inference gap; no discovery pin needed updating — the fixture's new `/login/alternate` route appears in discovery inventories naturally and no exact-count pin broke (source-ua-adapter real-world, inventory-ledger-ui and all 1d/variant workbench journeys green with the route present).
