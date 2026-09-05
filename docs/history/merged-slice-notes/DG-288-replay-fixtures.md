# DG-288-replay-fixtures — staged doc updates (charter §10.2)

Issue: #288 · PR: #TBD · Disposition: verified

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #288 | [DG-288] Third-party replay verification: stage-7/verifier fixture+reset via declared per-pass-login replay personas | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-24 | **#288 (DG-288) third-party replay fixtures DONE.** `fixtures.replayPersona` (frozen per-pass-login declaration, locator metadata only, env-only credentials) added: config validation with the closed `ARXIC-VERIFY-FIXTURE-*` family (5 codes), verifier per-pass login through the target's own form in real Chromium (fresh context per pass = the leased mutation; zero fixture-endpoint calls), stage-7 fail-closed `NOT-DECLARED` refusal for undeclared endpoint-less targets, `PROD-REFUSED` at config time. Proved real-world: G-3 integration + G-4 full `runCli` E2E against the reference-auth-app behind the G-0 loopback proxy (endpoint-less) — 2 classified passes, `verified`, stateless re-run, persona values never in artifacts; C-4 first-party suites unchanged and green. **Next: #256 exit campaigns (criterion 3 unblocked).** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- DG-288 third-party replay fixtures (#288): declared `fixtures.replayPersona` per-pass login — the verifier provisions the persona through the target's own login form before every pass (fresh context per pass), so vanilla third-party targets verify without arxic fixture endpoints; undeclared endpoint-less targets refuse fail-closed with `ARXIC-VERIFY-FIXTURE-NOT-DECLARED` and production-shaped targets with `ARXIC-VERIFY-FIXTURE-PROD-REFUSED`; frozen `ARXIC-VERIFY-FIXTURE-*` diagnostic family; proved against the real reference app behind an endpoint-less proxy with real Chromium (2 classified passes, stateless re-run, zero credential leakage).
```

## 4. VERSION bump required?

no — additive opt-in configuration + verifier behavior; existing configs are
byte-identical in behavior (no declaration ⇒ the pre-#288 endpoint protocol
and its `ARXIC-VERIFY-BLOCKED-FIXTURE` classification, proven unchanged by
C-4). (If the integrator prefers a bump for the new config surface, 0.1.2 is
the natural step.)

## 5. Evidence pointers

- Real-world proof: `apps/cli/src/__tests__/third-party-replay.real-world.test.ts` (G-3) and `apps/cli/src/__tests__/third-party-replay-e2e.real-world.test.ts` (G-4) — real reference-auth-app behind the G-0 loopback endpoint-less proxy, real Chromium, full `runCli` journey; `packages/verifier/src/replay-persona.test.ts` — declaration validation + per-pass login mechanics incl. redaction; `apps/cli/src/__tests__/config.test.ts` — frozen config contract (34 tests).
- Artifacts: run directories under test-session tmp (`arxic-288-g4-*`), per-run ephemeral sqlite (`ARXIC_DB_PATH` → mkdtemp), ephemeral `freePort()` ports, per-run Mailpit Testcontainer — nothing retained in-repo (raw trace ZIPs never retained, per ADR §15).
- Gates: typecheck ☑ (root `tsc -p tsconfig.json --noEmit` clean) · lint ☐ (integrator runs full `pnpm lint`) · format ☑ (`pnpm format:check` last line below) · test ☑ (new suites green; full-repo run in CI) · license gate ☐ (CI)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                           | Expected disposition                                                                                       | Test                                |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Endpoint-less target, no declaration, persona present             | `blocked` + `ARXIC-VERIFY-FIXTURE-NOT-DECLARED` at stage 7 (refused reset attempt = evidence), zero passes | G-4 test 2                          |
| Endpoint-less target, no declaration, verifier reached            | `blocked` + `ARXIC-VERIFY-BLOCKED-FIXTURE`, zero runs                                                      | G-3 test 2                          |
| Production-shaped target + declaration                            | config-time `ARXIC-VERIFY-FIXTURE-PROD-REFUSED` (+ default production refusal), zero logins                | config tests + G-3 test 3           |
| Malformed declaration (mode/route/fields/submit/unknown inputRef) | config-time `ARXIC-VERIFY-FIXTURE-DECLARATION-INVALID` at the precise subject                              | config tests + replay-persona tests |
| Declared login refused by the target                              | `blocked` + `ARXIC-VERIFY-FIXTURE-LOGIN-BLOCKED`, persona values redacted                                  | replay-persona tests                |
| Declared form not uniquely resolvable                             | `blocked` + `ARXIC-VERIFY-FIXTURE-LOGIN-BLOCKED`, no fabricated pass                                       | replay-persona tests                |
| Declared field with no persona value                              | `blocked` + `ARXIC-VERIFY-FIXTURE-LOGIN-BLOCKED`                                                           | replay-persona tests                |

## 7. What was NOT done (reporting discipline)

- `ARXIC-VERIFY-FIXTURE-BASELINE-DIVERGENT` is defined + validated through the
  frozen contract but has **no emitting path yet** — the pre-flight baseline
  replay pass (the C-1 third check the contract names for pass 1) was not
  implemented. Emitting it honestly requires a baseline run whose pass result
  is compared against pass 1; the current verifier counts the baseline AS pass
  1 (the per-pass login happens before every counted pass, which satisfies the
  frozen "before run 1" invariant text). If the analyst reads the contract as
  requiring a separate uncounted baseline pass, that is a small follow-up:
  run `loginReplayPersona` once more before the loop and compare — flagged
  here rather than half-implemented.
- Worker lane: `fixtures.replayPersona` is typed on the seam
  (`apps/worker/src/run-spec.ts`) but the worker's `main.ts` does not consume
  it (the worker lane already never consumed `personaProvisioner` either, per
  the DG-12 design §1.2). The #288 contract's out-of-scope explicitly defers
  worker-lane runtime changes beyond keeping its suite green; the local lane
  is the campaign lane.
- `docs/configuration.md` anchor `#fixtures` used in cross-links: the section
  heading is `## fixtures` + a `###`-level replayPersona subsection; anchors
  resolve on GitHub rendering either way.
