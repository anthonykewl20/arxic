# FIX-366-spec-text-race — staged doc updates (charter §10.2)

Issue: #366 · PR: <fill at open> · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

No milestone tracker row exists for #366 (gate-finding follow-up fix, not a
milestone issue); the session-log row below is the tracker deliverable.

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-03 | **#366 (FIX-366) generated-spec text: race-safe emission DONE.** The spec generator now emits strict-mode race-safe `text:` assertions: observation-derived heading anchors are role-qualified in the intent (`text@heading:<text>`, new grammar — the derivation knows they are heading accessible-names) and render as `getByRole('heading', { name, exact: true })`; plain hand-authored `text:` intents render as `getByText(<text>, { exact: true })` (substring → exact tightening, disclosed). Unknown role qualifiers and empty texts fail closed with ARXIC-COMPILE-UNSUPPORTED-STEP. `mutateIntent` now probes role-qualified assertions with a role-preserving value mutation (pre-fix they silently escaped sensitivity probing). Evidence: the real reference-auth-app /login renders `<h1>Login</h1>` + `<button>Login</button>` — two EXACT-«Login» elements — so exact alone cannot fix the #365-CI flake; role scoping resolves the h1 uniquely. Red-first: 11 unit tests + 2 new real-Chromium race tests failed on the pre-fix tree. Real-world: new `text-assertion-race.real-world.test.ts` boots the real reference-auth-app, drives the home→login navigation race, and proves unique resolution AND absence-failure; `third-party-replay` + `observation-form-flow` each ran 4/4 green before and after (the deterministic hand-authored `text:Login` trigger was already removed by #365 — the generator-level defect was demonstrated red-first instead); verifier/orchestrator/cli suites 498 tests green. One verifier sensitivity-proof arm evolved (disclosed): its substring-based insensitivity scenario is unrepresentable under exact semantics by design — it now proves the exact-text emission kills both probe operators end to end; the value-substitution INSENSITIVE diagnostic stays covered by the sensitivity-probe unit suite and the omission-tautology real-world test. Residual disclosed: a hand-authored plain `text:` intent whose text exactly duplicates two elements' full text still collides (no role info exists to scope it); `playwright-agent-adapter/fallback-generator.ts` still emits unscoped substring getByText (separate lane, not in this issue's named scope). |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-366 generated-spec text: race-safe emission (#366): `text:` assertions in generated Playwright specs are strict-mode race-safe under render races — observation-derived heading anchors become role-qualified intents (`text@heading:`) rendered as `getByRole('heading', { name, exact: true })`, plain `text:` intents tighten to exact full-text matching, unknown role qualifiers fail closed at compile (ARXIC-COMPILE-UNSUPPORTED-STEP), and the sensitivity probe mutates role-qualified assertions instead of silently skipping them; proven in real Chromium against the reference-auth-app login page whose `<h1>Login</h1>` and submit `<button>Login</button>` share the exact full text.
```

## 4. `VERSION` bump required?

yes — user-observable (generated spec content changes; verifier regenerates
trusted specs through the same generator): fold into the pending patch bump
lane per RELEASES.md; the integrator decides the exact version (0.1.2 pending
from FIX-364 staging).

## 5. Evidence pointers

- Real-world proof: `packages/playwright-compiler/src/__tests__/text-assertion-race.real-world.test.ts`
  — boots the REAL reference-auth-app (`bootFixtureApp`, ephemeral port,
  per-run sqlite), compiles the pre-#365 flake shape (home → login-page, text
  assertion) and executes the generated suite with real Chromium: the
  role-qualified heading assertion resolves uniquely through the navigation
  race (1 passed, no strict-mode violation) and still FAILS when the heading
  is absent (no blindness traded for race-safety).
- Attempt matrices (per-attempt pass/fail, real Chromium, sequential runs):
  - `apps/cli/src/__tests__/third-party-replay.real-world.test.ts` — BEFORE
    (pre-fix tree via stash): 4/4 pass. AFTER: 4/4 pass. The historical flake
    (1 fail/1 pass on origin/main, 3 fail/1 pass on the #365 branch — issue
    #366 attribution) had its deterministic trigger (hand-authored
    `text:Login`) already removed by #365 part 1; the generator-level defect
    is demonstrated red-first instead of via the matrix.
  - `packages/playwright-compiler/src/observation-form-flow.real-world.test.ts`
    — BEFORE: 4/4 pass (old emission pins). AFTER: 4/4 pass (new
    role-scoped emission pins, including the #312 placeholder replay that
    EXECUTES the compiled suite against /dashboard's `<h1>Dashboard</h1>`).
  - `text-assertion-race.real-world.test.ts` — AFTER: 4/4 pass; BEFORE the
    fix both tests failed red (`text@heading:` unsupported at compile).
- Red-first evidence: 11 failing tests on the pre-fix tree across
  `index.test.ts` (3 emission + 1 control-state), `sensitivity-probe.test.ts`
  (4, incl. the new role-preserving-mutation test), `observation-assertions.test.ts`
  (2), `form-flow.test.ts` (2); full failing-test list quoted in the PR.
- Gates: typecheck ☑ · lint ☑ · format ☑ (after note) · test (full `pnpm test`
  green locally; CI is the authoritative gate) ☑ · license gate ☑ (CI).
- Artifacts: none retained — proof is generated-spec content, per-attempt
  matrices, and suite output summaries; no raw Playwright trace ZIPs.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                     | Expected disposition                                                                                                                       | Test                                                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Plain `text:` matches N>1 elements by substring during a render race (the #366 flake class) | exact full-text emission — substring collisions cannot resolve; assertion still fails when absent                                          | `index.test.ts` "renders plain text assertions with exact matching…"                                                |
| Heading and control share the EXACT full text (real /login: h1 + button «Login»)            | role-qualified intent resolves uniquely via `getByRole('heading', …)`; spurious pre-navigation pass impossible (home has no Login heading) | `index.test.ts` "renders role-qualified text assertions…"; `text-assertion-race.real-world.test.ts` (real Chromium) |
| Role-qualified text absent from the page                                                    | run FAILS (race-safety not traded for blindness)                                                                                           | `text-assertion-race.real-world.test.ts` absence test                                                               |
| `text@<unknown-role>:` (e.g. `text@banana:Login`)                                           | blocked — ARXIC-COMPILE-UNSUPPORTED-STEP at compile, never an unresolvable emitted locator                                                 | `index.test.ts` "rejects a text assertion with an unsupported role qualifier fail-closed"                           |
| Empty role-qualified text (`text@heading:`)                                                 | blocked — same as empty plain text                                                                                                         | `index.test.ts` "rejects an empty role-qualified text assertion…"                                                   |
| Role-qualified assertion reaches the sensitivity probe                                      | probed with role-preserving value mutation (pre-fix: silently escaped probing — blindness)                                                 | `sensitivity-probe.test.ts` "probes role-qualified text assertions…"                                                |
| Probe value mutation on role-qualified assertion                                            | mutated locator can never match → killed (assertion pins its value)                                                                        | same test (`__arxic-probe-never-match__` mutant pinned)                                                             |
| Derivation receives ambiguous/duplicate headings                                            | deduped + capped as before; now role-qualified so emission is race-safe by construction                                                    | `observation-assertions.test.ts`, `form-flow.test.ts`                                                               |
| Substring-only weak assertion (`text:Logged in` vs «Logged in as x»)                        | no longer passes at all under exact semantics (the weak-assertion class is closed, not flagged)                                            | verifier real-world sensitivity arm evolved accordingly (disclosed)                                                 |
