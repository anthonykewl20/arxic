# FIX-379-fallback-text-race — staged doc updates (charter §10.2)

Issue: #379 · PR: <fill at open> · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

No milestone tracker row exists for #379 (follow-up bug fix from the #366
slice, not a milestone issue); the session-log row below is the tracker
deliverable.

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-04 | **#379 (FIX-379) fallback-generator text: race-safe emission DONE.** The `playwright-agent-adapter` fallback lane now mirrors the #366 spec-generator emission decision: role-qualified intents (`text@heading:<text>`) render as `getByRole('heading', { name, exact: true })` behind the same fail-closed role allowlist (heading only — the one role with derivation-side evidence), plain `text:` intents render as `getByText(<text>, { exact: true })` (substring → exact tightening, disclosed), and unknown roles / empty payloads fail generation closed with `ARXIC_AGENT_FALLBACK_FAILED`. Pre-fix, a role-qualified intent fell into the generic body-containment branch and asserted the literal grammar string (guaranteed miss) while plain `text:` matched every element CONTAINING the text (strict-mode-fragile under render races). Red-first: 4 unit assertions failed on the pre-fix tree (emission + fail-closed) and the real-Chromium heading-collision test failed against the stashed pre-fix generator (verified by stash/pop). Real-world: new `text-assertion-race.real-world.test.ts` boots the REAL reference-auth-app and proves in real Chromium that the role-qualified heading assertion resolves `<h1>Login</h1>` uniquely through the exact-full-text collision with the submit `<button>Login</button>` (1 passed, no strict-mode violation), still fails when the heading is absent (no blindness traded for race-safety), and a plain `text:` assertion resolves exactly on the anonymous home surface; the adapter suite 63/63 green incl. the existing real agent/fallback flows. The known #366-documented limitation is shared by this lane: a hand-authored plain `text:` intent whose text exactly duplicates two elements' full text still collides (no role information exists to scope it). Next: the DG-12 exit gate lane (#256). |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-379 fallback-spec text: race-safe emission (#379): generated fallback Playwright specs (`packages/playwright-agent-adapter`) are strict-mode race-safe under render races, mirroring the #366 spec-generator decision — role-qualified `text@heading:` intents render as `getByRole('heading', { name, exact: true })` behind the fail-closed role allowlist, plain `text:` intents tighten to exact full-text matching, unknown role qualifiers and empty payloads fail generation closed with `ARXIC_AGENT_FALLBACK_FAILED`; proven in real Chromium against the reference-auth-app login page whose `<h1>Login</h1>` and submit `<button>Login</button>` share the exact full text.
```

## 4. `VERSION` bump required?

yes — user-observable (generated fallback spec content changes): fold into the
pending patch bump lane per RELEASES.md; the integrator decides the exact
version at fold time.

## 5. Evidence pointers

- Real-world proof: `packages/playwright-agent-adapter/src/__tests__/text-assertion-race.real-world.test.ts`
  — boots the REAL reference-auth-app (`bootFixtureApp`, ephemeral port,
  per-run sqlite), generates the fallback spec via `generateSpecFromWorkflow`,
  and executes it in real Chromium through `runFallback`: the role-qualified
  heading assertion resolves uniquely through the strict-mode collision
  (1 passed, no `strict mode violation`), the absent-heading case still fails
  honestly, and the plain `text:` exact assertion resolves on the anonymous
  home surface.
- Unit red-first: `packages/playwright-agent-adapter/src/__tests__/text-race.test.ts`
  (5 tests — emission shapes, fail-closed role allowlist + empty payloads,
  preservation of the generic containment lane for non-text intents).
- Artifacts: none retained (per ADR §15 no raw trace ZIPs; failed-run traces
  live only in per-test temp dirs deleted in `afterAll`).
- Gates: typecheck ☑ · lint ☑ · format ☑ (run post-note) · test (adapter 63/63;
  full-repo suite in the PR CI) ☑ · license gate ☑ (no new deps; devDependency
  `@arxic/real-world-testkit` is an internal workspace package already in the graph).

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                | Expected disposition                                                    | Test                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Role outside the allowlist (`text@banner:Login`)       | generation fails closed `ARXIC_AGENT_FALLBACK_FAILED` (blocked)         | `text-race.test.ts` — fails closed on a role outside the #366 allowlist |
| Empty role-qualified / plain text payload              | generation fails closed (blocked)                                       | `text-race.test.ts` — fails closed on empty payloads                    |
| Heading absent from the rendered page                  | run fails honestly with the expected text in output (contradicted)      | `text-assertion-race.real-world.test.ts` — absent-heading case          |
| Exact-full-text heading/button pair on the real /login | unique resolution via role scoping, no strict-mode violation (observed) | `text-assertion-race.real-world.test.ts` — collision case               |
| Non-text intent (`visible:.dashboard`)                 | generic body-containment lane unchanged (observed)                      | `text-race.test.ts` — containment preservation                          |
