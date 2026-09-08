# WEB-402-PERSONA-VARIANTS-1C — flag and state execution variants for campaigns

Issue: #402 · PR: (this PR) · Disposition: observed (implemented, local gates green, CI on the PR head is the remaining gate — an LLM cannot assign `verified`)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #402 | [WEB-402-PERSONA-VARIANTS-1C] flag and state execution variants for campaigns | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-09 (7) | **#402 (WEB-402-PERSONA-VARIANTS-1C) flag/state execution variants DONE.** Campaign variants widen to a persona|flag|state union (mixed kinds allowed, still ≤4, unique `/^[a-z0-9-]+$/` keys): flag entries carry 1–30 named booleans (name `/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/u`), state entries carry `'anonymous'` only; an anonymous state variant on an already-anonymous project persona is refused 400 (degenerate duplicate). Fan-out (queueCampaign, tick fire, rebind) stamps the non-secret payload on the scope — `variantFlags` for flag kind, `variantState: 'anonymous'` for state — persona entries stay `variantKey`-only (credentials env-only); drain's `variantEnvironment` gives flag/state runs the unmodified base env while still throwing for unresolvable keys; the child builds a per-run settings copy (flags merged over project flags; anonymous switch clears persona secret refs the way the validated anonymous shape does) that flows through the ONE unchanged `executionConfig(...)` — proven by diverging real `runs/<id>/engine-config.json` snapshots (flag override merged into `scope.featureFlags`; state run `scope.personas: ['anonymous']` with no replayPersona/personaProvisioner). Dashboard variants editor gains a per-row kind select (one flag per row in the UI; API accepts 30 — disclosed gap) and the dialog saves mixed-kind campaigns through the real API with per-variant outcome attribution. Real reference-auth-app journeys (Workbench.open + wb.tick + real Chromium) prove fan-out order `[undefined,'persona-a','flag-b','state-c']`, recurring fire + drift-rebind payload stamping, and the full validation matrix; distinct-identity AC2 proof stays the paid-inference gap. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- WEB-402-PERSONA-VARIANTS-1C flag and state execution variants for campaigns (#<PR>): campaign variants are now a persona|flag|state union — flag variants record non-secret boolean overrides merged into the child engine config, state variants rerun a row anonymously (refused 400 when the project default is already anonymous), both stamp their payload on the workflow scope at every fan-out site (enqueue, recurring fire, drift rebind) while persona credentials remain env-only; real-world journeys prove fan-out order, engine-config.json divergence per run, drain guard behavior and the mixed-kind dialog over the reference auth app.
```

## 4. VERSION bump required?

no — sub-slice of the open #402 web-product scope; no release fold in this PR (follow the #491/#493 fold precedent).

## 5. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/persona-variants-1c.real-world.test.ts` (mixed fan-out + engine-config divergence, validation matrix, non-degenerate state acceptance, unset-secret blocking), `persona-variants-recurring.real-world.test.ts` (flag payload through recurring fire + drift rebind), `persona-variants-ui.real-world.test.ts` (real Chromium dialog, mixed persona+flag campaign, per-variant outcomes, zero page errors) — all against the real reference-auth-app checkout via `Workbench.open`/`startWorkbench` with per-run `mkdtemp` state dirs and `ARXIC_MAILPIT_*` left unset.
- Artifacts: `docs/evidence/WEB-402-PERSONA-VARIANTS-1C/red.txt` (verbatim pre-implementation failures, 7 tests red across 3 files + the UI journey red) and `green.txt` (two consecutive full-green runs, 21/21 across the five persona-variant suites).
- Gates: typecheck ☑ (`pnpm typecheck` in apps/web) · lint ☑ (`pnpm lint` from the primary repo root) · format ☑ (last line pasted on the PR) · test ☑ (21 slice tests + 18 regression tests green locally) · license gate ☐ (CI).

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                  | Expected disposition                                                                                                                                                 | Test                                                       |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| flag variant with 0 flags / 31 flags / missing payload                   | 400 'Flag variants must declare 1–30 named boolean flags', zero runs enqueued                                                                                        | `persona-variants-1c.real-world.test.ts` (observed)        |
| flag name `'9bad'` / `'has space'`                                       | 400 'Flag names use letters, digits, dot, dash or underscore'                                                                                                        | same file (observed)                                       |
| non-boolean flag value                                                   | 400 'Flag values must be booleans'                                                                                                                                   | same file (observed)                                       |
| foreign entry keys (persona payload on flag kind; flags on persona kind) | 400 'Campaign variants must be a list of variant definitions'                                                                                                        | same file (observed)                                       |
| state value other than `'anonymous'` (or missing)                        | 400 'The only supported state variant is anonymous'                                                                                                                  | same file (observed)                                       |
| state variant on a project whose persona mode is already anonymous       | 400 'An anonymous state variant is identical to this project's default persona'                                                                                      | same file (observed)                                       |
| persona variant secret unset at drain                                    | that run blocks with 'A selected secret reference is not available on this server', no engine-config.json; flag sibling reaches the engine with its override visible | same file (observed)                                       |
| unresolvable variantKey for flag/state kind                              | `variantEnvironment` throws — run blocks, never a silent default run                                                                                                 | `persona-variants.test.ts` (observed)                      |
| recurring fire / drift rebind of a flag-variant campaign                 | fired and rebound runs carry `variantFlags` on the scope                                                                                                             | `persona-variants-recurring.real-world.test.ts` (observed) |
| label slugging to an empty variant key via the dialog                    | server 400 surfaced verbatim through the error alert                                                                                                                 | `persona-variants-ui.real-world.test.ts` (observed)        |

Known gaps (do not re-survey): the dashboard exposes ONE flag per variant row (the API accepts up to 30 — simplification disclosed in the editor copy); without a live model every agent run ends blocked, so variant divergence is proven at the engine-config.json boundary, not at verified outcomes; the distinct-authenticated-identity (AC2) proof still rides the paid-inference gap; distinct-login-path personas were NOT in this slice's scope (SYNC follow-up remains open).
