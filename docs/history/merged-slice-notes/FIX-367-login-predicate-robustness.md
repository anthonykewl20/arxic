# FIX-367-login-predicate-robustness — staged doc updates (charter §10.2)

Issue: #367 · PR: #370 · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

No milestone tracker row exists for #367 (follow-up fix, not a milestone issue);
the session-log row below is the tracker deliverable.

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-03 | **#367 (FIX-367) login-predicate robustness DONE.** `workflowPerformsLogin` now recognizes an email-only transition (no password ref) as a declared login surface — passwordless targets replay from the observed anonymous state instead of the #362 injection branch — and compares refs case-insensitively so `persona.newPassword` hits the same change-password exclusion as `persona.newpassword`. Red-first: both new tests failed on origin/main. Real Chromium against the booted vulnerable-auth-app proved the email-only surface (the FIX-364 counterexample shape) now generates the anonymous-start fixture; the compiler suite passed 42/42 with the post-login injection boundary tests unchanged. One expectation flipped (email-only → anonymous), named in the PR: the #364 start-state contract governs it. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-367 login-predicate robustness (#367): recognize email-only (passwordless) login surfaces as login-owning so they replay from the observed anonymous state, and compare persona refs case-insensitively so `persona.newPassword` cannot bypass the change-password exclusion; red-first on origin/main, real-Chromium proof on the vulnerable-auth-app email-only surface.
```

## 4. `VERSION` bump required?

yes — folds into the pending 0.1.2 bump already staged by FIX-364 (same
user-observable replay start-state lane); not double-bumped by this slice per
charter §10.

## 5. Evidence pointers

- Real-world proof: `packages/playwright-compiler/src/generality.real-world.test.ts` —
  real Chromium drives the booted vulnerable-auth-app; the live email-only
  surface (count-guard test) now yields an anonymous-start fixture (no
  `ARXIC_REPLAY_PERSONA_STORAGE_STATE`, clear-cookies context).
- Boundary tests: `packages/playwright-compiler/src/index.test.ts` — the two
  `#367` tests (email-only anonymous; camelCase-newPassword excluded) replace
  the FIX-364-era "keeps replay-persona injection for an email-only transition"
  pin, which encoded the defect; the other FIX-364 boundary pins
  (password+newpassword without email; 3-field change-password) are unchanged
  and green.
- Artifacts: none retained — the proof is generated-fixture content plus live
  form-count assertions, not screenshots/traces.
- Gates: red-first observed in-slice (2 failed on origin/main → 42/42 compiler
  suite after); lint/typecheck/typecheck:packages clean; full-suite + format
  gates run in CI on PR #370's head.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                      | Expected disposition                                  | Test                                                       |
| ------------------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------- |
| Email-only login workflow with a declared replay persona     | observed anonymous start — injection branch not taken | `index.test.ts` `#367 email-only … anonymous state`        |
| Email+password+`persona.newPassword` transition (any casing) | injection branch — change-password exclusion holds    | `index.test.ts` `#367 excludes a change-password … casing` |
| Post-login workflow without a login-surface transition       | injection branch unchanged (#362 path intact)         | `index.test.ts` post-login + password/newpassword pins     |
