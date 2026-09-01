# FIX-364-conditional-replay-start-state — staged doc updates (charter §10.2)

Issue: #364 · PR: pending · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #364 | [FIX-364] Conditional replay start state | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-01 | **#364 (FIX-364) Conditional replay start state DONE.** The compiler emits anonymous, clear-cookie contexts for workflows that submit both persona login credentials, while post-login workflows retain the #362 ephemeral storage-state path. Real Chromium against the bootable endpoint-less reference-auth-app exercised the anonymous login and authenticated logout paths; the deterministic verifier accepted two clean passes for each. Malformed post-login storage state remained fail-closed. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-364 Conditional replay start state (#364): compile login-performing workflows with an anonymous replay context while preserving ephemeral replay-persona storage-state injection and malformed-state refusal for post-login workflows, proven through real Chromium against the reference-auth-app.
```

## 4. `VERSION` bump required?

yes → 0.1.2, because the replay start-state correction is user-observable per
RELEASES.md

## 5. Evidence pointers

- Real-world proof: `apps/cli/src/__tests__/third-party-replay.real-world.test.ts` —
  real Chromium drives the bootable endpoint-less reference-auth-app through
  anonymous login and authenticated logout replays.
- Artifacts: per-run screenshots and adjacent privacy/sanitization provenance are
  retained by the verifier test run; raw trace ZIPs are not attached.
- Gates: targeted compiler/verifier suites passed; full gate and format gate pending
  at note creation.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                    | Expected disposition                                                | Test                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| A login workflow receives replay-persona storage state     | observed anonymous login form before its own credential interaction | `third-party-replay.real-world.test.ts` anonymous login replay         |
| A post-login workflow receives malformed storage state     | blocked by `ARXIC-COMPILE-REPLAY-PERSONA-STATE-INVALID`             | `third-party-replay.real-world.test.ts` malformed storage-state replay |
| A post-login workflow receives authenticated storage state | deterministic verifier accepted two passes                          | `third-party-replay.real-world.test.ts` authenticated logout replay    |
