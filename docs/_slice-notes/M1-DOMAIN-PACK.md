# M1-DOMAIN-PACK — staged doc updates (charter §10.2)

Issue: #88 · PR: #<N> · Disposition: mixed (verified / blocked) — `contradicted` eliminated

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

`#88` is a fix to the M1-08 auth domain pack (#22, already ☑ done); it is **not** a new
milestone tracker row. The milestone table is unchanged. The integrator should update the
`🔖 RESUME HERE` / second-batch prose to record that the #88 over-fit is resolved: the
auth-domain-pack now derives candidates from per-app observed evidence, and the Express
app verifies login/logout with zero `contradicted`.

```
(no new row — #88 resolves the over-fit filed against #22 by the #27 de-risk spike; M1-08 #22 stays ☑ done)
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-07 (8) | **#88 Auth domain pack: evidence-driven candidates DONE.** `@arxic/auth-domain-pack` `authCandidates()` no longer hardcodes reference-app routes; it derives login/logout/password-change/TOTP/reset candidates from a per-app `AuthSurface` (observed states that the compiler maps to routes, observed success assertions, and which capabilities an app supports) supplied as data by `@arxic/real-world-testkit` (`FixtureApp.authSurface`). Candidates are emitted `hypothesized` at most (ADR §2) — only the stage-10 verifier may originate `verified`, and the verifier promotes on run results regardless of input status. A new `capabilityBlocker` + `ARXIC-AUTH-CAPABILITY-UNSUPPORTED` diagnostic makes a structurally absent capability surface as an explicit `blocked` (checked before the evidence/fixture gates), never a dropped candidate and never a `contradicted` that hides a missing capability. No app-name branching anywhere in `packages/**/src`. Real-Chromium proof against BOTH apps: reference → login/logout/password-change `verified`, reset×2/TOTP `blocked` (fixture); vulnerable → login/logout `verified` (were `contradicted`), password-change/TOTP `blocked` (`ARXIC-AUTH-CAPABILITY-UNSUPPORTED`: no route / no TOTP), reset×2 `blocked` (fixture). `manifest.contradicted === 0` for both. Compiler + verifier untouched. Downstream `@arxic/reconciler` test updated to the new `authCandidates(surface)` signature. Gates green (typecheck/lint/format/test/license). **M1 14/15** (only #27 M1-EXIT remains). |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- M1-DOMAIN-PACK evidence-driven candidates (#88): `@arxic/auth-domain-pack` `authCandidates()` is no longer over-fit to `reference-auth-app`. It takes a per-app `AuthSurface` (observed entry/success states, success assertions, and supported/unsupported flags) supplied as data by `@arxic/real-world-testkit` (`FixtureApp.authSurface`), and derives login/logout/password-change/reset/TOTP candidates from it — the same pack now produces sensible candidates for a structurally different app with no app-name branching in `packages/**/src`. Candidates are `hypothesized` at most (ADR §2; the verifier still originates `verified` on two clean runs). A capability an app structurally lacks surfaces as an explicit `blocked` via a new `capabilityBlocker` + `ARXIC-AUTH-CAPABILITY-UNSUPPORTED` diagnostic (checked before the evidence and fixture gates), never a dropped candidate or a `contradicted` hiding a missing capability. Real-Chromium proof against both fixture apps: the Express `vulnerable-auth-app` (all forms on `/`, no password-change route, no TOTP) now verifies login/logout (previously `contradicted` on a 404 `goto /login`) and honestly blocks password-change/TOTP as unsupported; the Next.js reference app is unchanged (3 verified / 3 fixture-blocked); `manifest.contradicted === 0` for both. Compiler and verifier untouched; `@arxic/reconciler` real-world test updated to the new signature.
```

## 4. `VERSION` bump required?

No. This is an internal correctness fix to a private (`0.0.0`) domain pack — no published
artifact, no user-observable API beyond the workspace. `VERSION` stays `0.0.0`; the next
bump is `0.2.0` at M1-EXIT (#27) per `RELEASES.md`.

## 5. Evidence pointers

- Real-world proof: `packages/auth-domain-pack/src/real-world.test.ts` — `describe.each(FIXTURE_APPS)`, real Chromium (Playwright 1.62.1) driving both `reference-auth-app` (Next.js) and `vulnerable-auth-app` (Express) booted via `@arxic/real-world-testkit` on ephemeral ports + per-run temp sqlite. Login/logout/password-change verified by two clean passes each; reset/TOTP blocked on fixtures; vulnerable password-change/TOTP blocked as unsupported.
- Artifacts: written to per-run `mkdtemp` output dirs (`domain-manifest.json`, `coverage-matrix.json`, per-workflow compiled specs + screenshots/traces) — cleaned up in `afterAll`; nothing retained under `docs/evidence/` for this slice (proof is the parameterized real-Chromium test, which is the recording-equivalent per ADR §15).
- Gates: typecheck ☑ · lint ☑ · test (auth-domain-pack 10: 8 unit + 2 real-Chromium) ☑ · license gate ☑ (0 rejected) · format ☑ (run after this note).

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                             | Expected disposition                                                                            | Test                                                                                                    |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| App lacks a capability (vulnerable has no password-change route, no TOTP)           | `blocked` — `ARXIC-AUTH-CAPABILITY-UNSUPPORTED` (explicit, never dropped, never `contradicted`) | `index.test.ts` "an app that lacks a capability…"; `real-world.test.ts` vulnerable password-change/TOTP |
| Capability needs a fixture the pack does not provision (reset → inbox, TOTP → totp) | `blocked` — `ARXIC-AUTH-FIXTURE-UNAVAILABLE`                                                    | `index.test.ts` coverage-matrix test; `real-world.test.ts` reset×2 (both apps), reference TOTP          |
| Candidate with no source+runtime evidence                                           | `blocked` — `ARXIC-AUTH-NO-EVIDENCE`                                                            | `index.test.ts` "blocks…without source and runtime evidence"                                            |
| Unsupported compiler step / compile failure                                         | `blocked` — `ARXIC-AUTH-COMPILE-BLOCKED` (verifier still runs the rest)                         | `index.test.ts` "classifies an unsupported compiler step…"                                              |
| Over-fit eliminated: structurally different app no longer yields `contradicted`     | `contradicted === 0` (login/logout `verified` instead)                                          | `real-world.test.ts` `manifest.contradicted === 0` for both apps                                        |
| Generator never assigns `verified`/`observed`-as-verified                           | all candidates `status: 'hypothesized'`                                                         | `index.test.ts` "every candidate is hypothesized…"                                                      |
| Happy path: supported capability on a conventional app verifies in real Chromium    | `verified` (two clean passes)                                                                   | `real-world.test.ts` reference login/logout/password-change; vulnerable login/logout                    |
