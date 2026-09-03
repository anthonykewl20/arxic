# FIX-368-replay-capture-gate — staged doc updates (charter §10.2)

Issue: #368 · PR: #374 · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (append to the ALL-Domain milestone table)

```
| #368 | [FIX-368] Verifier skips the replay-persona capture for login-owning workflows | ☑ done (PR #374) — same `workflowPerformsLogin` predicate as the fixture generator gates `#reset`/`#execute`; zero wasted per-pass browser logins (reference-auth-app proxy measured 4 → 2 login POSTs); post-login capture + LOGIN-BLOCKED + NOT-DECLARED refusals unchanged |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-03 | **#368 (FIX-368) Verifier replay-persona capture gating DONE.** The verifier now computes the fixture generator's `workflowPerformsLogin` predicate at verify() entry and gates the per-pass replay-persona capture on it: login-owning candidates skip the capture entirely (their generated fixture replays anonymous by contract and ignores `ARXIC_REPLAY_PERSONA_STORAGE_STATE`), so the wasted real-browser login per pass and its stale LOGIN-BLOCKED failure mode are gone; post-login workflows keep the fail-closed capture (LOGIN-BLOCKED on refused credentials), the declared-without-persona NOT-DECLARED refusal stays, and no-persona runs keep anonymous hygiene. Red-first: unit red reproduced the defect exactly (capture attempted against an unreachable origin → LOGIN-BLOCKED with zero runs); real-world red on the endpoint-less reference-auth-app measured 4 login POSTs for the G-3 login-owning workflow (2 capture + 2 suite), post-fix exactly 2 (suite-only, both passes still `verified` by the deterministic verifier); the #288 unit pin migrated honestly — the login-owning shape now asserts 0 capture logins and a NEW post-login pin (real form server, real Chromium) carries "one leased capture login per pass, zero endpoint-protocol calls" forward. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-368 Verifier replay-persona capture gating (#368): the per-pass replay-persona storage-state capture is now gated on the same `workflowPerformsLogin` predicate the fixture generator uses, so login-owning workflows skip the wasted real-browser capture login per pass (reference-auth-app endpoint-less proxy measured 4 → 2 login POSTs) and its unreachable LOGIN-BLOCKED failure mode; post-login workflows keep the fail-closed capture and LOGIN-BLOCKED classification, the declared-without-persona NOT-DECLARED refusal is unchanged, and the ephemeral env channel never carries a state the fixture would ignore.
```

## 4. `VERSION` bump required?

yes → 0.1.2, because the eliminated per-pass capture login is user-observable
(faster verification, fewer leased logins against third-party targets) per
RELEASES.md — fold together with the pending FIX-364 0.1.2 bump at integrate
time.

## 5. Evidence pointers

- Real-world proof: `apps/cli/src/__tests__/third-party-replay.real-world.test.ts`
  (C-1/AC-2) — real Chromium against the bootable endpoint-less
  reference-auth-app behind the loopback proxy; the proxy's new
  `proxiedRequests()` log counts login submits: exactly one per suite pass,
  zero capture logins, both passes still `verified`. AC-1 (post-login
  authenticated logout, two clean persona passes) and AC-3 (bad-credentials
  LOGIN-BLOCKED) stay green against the same real app.
- Unit red-first: `packages/verifier/src/index.test.ts` — the red run
  reproduced the defect verbatim (`ARXIC-VERIFY-FIXTURE-LOGIN-BLOCKED:
Per-pass replay-persona login failed` for a login-owning workflow, zero
  suite runs); green asserts the suite runs, `verified`, and the child env
  carries no `ARXIC_REPLAY_PERSONA_STORAGE_STATE`.
- Post-login pins: `packages/verifier/src/replay-persona.test.ts` — real form
  server + real Chromium: 2 capture logins (one per pass), zero
  fixture-protocol calls, captured state reaches the suite as parseable JSON;
  unreachable-origin LOGIN-BLOCKED and NOT-DECLARED refusals pinned in
  `index.test.ts`.
- Gates: lint ✓ · typecheck + typecheck:packages ✓ · targeted suites
  (verifier 75, third-party-replay 7) ✓ · full `pnpm test` + `format:check`
  verified in CI on the PR.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                             | Expected disposition                                                        | Test                                                                             |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Login-owning workflow + declared replayPersona + persona (capture would be skipped) | suite runs, no capture attempted, no storage state injected                 | `index.test.ts` #368 skip test (red→green)                                       |
| Post-login workflow + declared replayPersona + unreachable origin                   | blocked, `ARXIC-VERIFY-FIXTURE-LOGIN-BLOCKED`, zero runs                    | `index.test.ts` #368 fail-closed pin                                             |
| Declared replayPersona without a persona (login-owning)                             | blocked, `ARXIC-VERIFY-FIXTURE-NOT-DECLARED`, zero runs, before any capture | `index.test.ts` #368 refusal pin                                                 |
| Post-login workflow + refused credentials on the real form                          | blocked, `ARXIC-VERIFY-FIXTURE-LOGIN-BLOCKED`, persona redacted             | pre-existing `replay-persona.test.ts` + real-world AC-3 (unchanged, still green) |
| Malformed injected storage state (post-login fixture)                               | suite fails closed `ARXIC-COMPILE-REPLAY-PERSONA-STATE-INVALID`             | real-world AC-3 (unchanged)                                                      |
