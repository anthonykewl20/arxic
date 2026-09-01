# FIX-364-conditional-replay-start-state — staged doc updates (charter §10.2)

Issue: #364 · PR: #365 · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #364 | [FIX-364] Conditional replay start state | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-01 | **#364 (FIX-364) Conditional replay start state DONE.** The compiler treats only transitions with `persona.email` and `persona.password` without `persona.newpassword` as login-owning, so single-transition change-password forms and password+newpassword flows start authenticated; post-login workflows retain the #362 ephemeral storage-state path. The anonymous-login workflow now asserts `url:/login` rather than `text:Login`, avoiding strict-mode render-race fragility and tautology-prone matching (gate-finding #366; pre-existing flake reproduced on an origin/main baseline). Real Chromium against the bootable endpoint-less reference-auth-app exercised the anonymous login and authenticated logout paths; the deterministic verifier accepted two clean passes for each. Malformed post-login storage state remained fail-closed. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-364 Conditional replay start state (#364): compile only transitions with `persona.email` and `persona.password` without `persona.newpassword` as login-owning, so change-password/password+newpassword flows start authenticated; preserve ephemeral replay-persona storage-state injection and malformed-state refusal for post-login workflows; the anonymous-login assertion uses `url:/login` rather than `text:Login` for race-safe, non-tautological matching, with real Chromium against the reference-auth-app.
```

## 4. `VERSION` bump required?

yes → 0.1.2, because the replay start-state correction is user-observable per
RELEASES.md

## 5. Evidence pointers

- Real-world proof: `apps/cli/src/__tests__/third-party-replay.real-world.test.ts` —
  real Chromium drives the bootable endpoint-less reference-auth-app through
  anonymous login and authenticated logout replays.
- Boundary tests: `packages/playwright-compiler/src/index.test.ts` — three
  tests pin replay-persona storage-state injection for password+new-password
  without email, email-only, and the 3-field change-password form.
- Artifacts: per-run screenshots and adjacent privacy/sanitization provenance are
  retained by the verifier test run; raw trace ZIPs are not attached.
- Gates: targeted suites are green locally after `a3f4ca8` (compiler index: 41
  passed; AC-2 filtered real-world run: 2 passed); `pnpm format:check` was clean
  before the hardening round; the full-suite gate executes in CI on PR #365's
  head — [PR checks](https://github.com/anthonykewl20/arxic/pull/365/checks).

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                    | Expected disposition                                                | Test                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| A login workflow receives replay-persona storage state     | observed anonymous login form before its own credential interaction | `third-party-replay.real-world.test.ts` anonymous login replay         |
| A post-login workflow receives malformed storage state     | blocked by `ARXIC-COMPILE-REPLAY-PERSONA-STATE-INVALID`             | `third-party-replay.real-world.test.ts` malformed storage-state replay |
| A post-login workflow receives authenticated storage state | deterministic verifier accepted two passes                          | `third-party-replay.real-world.test.ts` authenticated logout replay    |
