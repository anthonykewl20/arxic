# KOEL-LOGIN-538 — staged doc updates (charter §10.2)

Issue: #538 · PR: #<fill> · Disposition: observed (red→green demonstrated against a real dockerized koel with a real browser engine; CI skips the koel suite because the rehearsal clone/image are local-only, so the third-party proof itself remains local-observed, not CI-verified)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #538 | [KOEL-LOGIN-538] visual engine signs into a real hash-routed SPA (koel) | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-09 | **#538 (KOEL-LOGIN-538) visual engine signs into a real hash-routed SPA (koel) DONE.** Red-first against dockerized koel (fresh per-run sqlite, ephemeral port, `koel:init`-seeded upstream first-admin): the label-less surface was undeclarable (400), the pathname-only post-submit wait misclassified successful hash-routed sign-ins as failures, and captures raced SPA mask mounts. Fixed: optional `emailPlaceholder`/`passwordPlaceholder` surface declarations (types/projects validation), bounded placeholder resolution + form-gone success signal in `signIn`, 15 s mount window for declared privacy masks. Wrong password → `blocked`/`login-failed` with retained engine error and exactly one attempt; valid sign-in → `observed` capture with `authenticated: true` and the identity mask applied. Evidence `docs/evidence/WEB-402-KOEL-LOGIN/`; Next fixture login suites, persona variants and config omissions pass unchanged. Provider account-logins stay owner-blocked. **M<next> <n>/<total>.** Next: #402 paid inference proofs (credential-blocked) and remaining state/persona coverage. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- KOEL-LOGIN-538 real SPA sign-in for visual runs (#<fill>): visual projects can declare placeholder-only login surfaces (`emailPlaceholder`/`passwordPlaceholder`, non-secret like the labels), the sign-in engine resolves fields label→type→placeholder with the resolution method recorded in the sanitized timeline, treats the bounded disappearance of the login form as the success signal for hash-routed SPAs, and gives declared privacy masks a bounded mount window before refusing a capture. Proven against a real dockerized koel: wrong password → blocked `login-failed` with the retained observed engine error and one bounded attempt; valid sign-in → authenticated masked capture (`docs/evidence/WEB-402-KOEL-LOGIN/`). Provider account-logins remain owner-blocked.
```

## 4. `VERSION` bump required?

no — extends the visual-login surface declarability and hardens its classification; no version-bound surface changes (pins untouched; per RELEASES.md treated as internal proof hardening for this slice)

## 5. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/visual-koel-login.real-world.test.ts` — real Chromium through `Workbench.open`/`enqueue`/`idle` against dockerized koel (`koel-php83:rehearsal`, per-run `mkdtemp` sqlite + `koel:init --no-interaction`, ephemeral `127.0.0.1::8123`, credential proof via the real `/api/me` before the browser run); CI skips cleanly unless `ARXIC_KOEL_LOGIN_REQUIRED=1`
- Evidence package: `docs/evidence/WEB-402-KOEL-LOGIN/` — observed run (authenticated masked capture, privacy provenance, timeline + sanitization) and blocked run (retained engine error, single failed attempt)
- Regressions: `visual-auth`, `visual-matrix-auth`, `config-omissions`, `execution`, `persona-variants`, `persona-variants-1d` — 27 tests green after the engine changes
- Gates: typecheck ✓ · lint (pre-PR, full in CI) · format (run after this note) · test: targeted suites above, full suite in CI

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                      | Expected disposition                                                                                                                                 | Test                                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Wrong persona password on a real SPA login form              | Run `blocked` with `login-failed` finding, retained observed engine error, exactly one bounded attempt, no secret in evidence                        | `visual-koel-login.real-world.test.ts` blocked run |
| Label-less login surface (no `<label>`, `type="email"` only) | Operator declares placeholders; engine resolves structurally and records the live-DOM resolution method in the timeline                              | same test, happy run (`fields by type/type`)       |
| Hash-routed SPA never leaves the login pathname              | Successful sign-in detected via bounded login-form disappearance; failure still classifies honestly when the form stays visible                      | same test, both runs                               |
| Required privacy mask not yet mounted (SPA)                  | Bounded readiness window; mask that never appears still refuses the capture with the honest `capture-blocked-check-target-and-privacy-masks` finding | readiness-phase window + existing refusal path     |
