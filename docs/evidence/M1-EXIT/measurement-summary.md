# M1-EXIT measurement summary

Convenience record for the #27 (M1-EXIT) gate measured against `fed2358`. The
proof is the real-world test suite itself, which runs in CI on every push; this
file only records what the local gate observed so a reviewer does not have to
re-run to see the shape of the result. If this file ever disagrees with the suite,
the suite wins.

## Full-suite reproducibility (§23.8 — "suites pass twice from clean fixtures")

`pnpm test` (vitest, `fileParallelism: false`, real Chromium/Docker/Mailpit
Testcontainers, `ARXIC_MAILPIT_SMTP`/`ARXIC_MAILPIT_API` unset) was run twice from
clean state on the merged tree. Both runs green:

| Run | Test files     | Tests            | Duration | Exit |
| --- | -------------- | ---------------- | -------- | ---- |
| 1   | 81 passed (81) | 534 passed (534) | 549.90s  | 0    |
| 2   | 81 passed (81) | 534 passed (534) | 640.96s  | 0    |

Within the suite, the generated login suites themselves pass twice from clean
fixtures for **both** apps: `packages/verifier/src/real-world.test.ts` asserts
`runs === [{ passed: true }, { passed: true }]` and the verifier calls
`resetAndSeedFixtures` (`POST /__arxic/reset` then `/__arxic/seed`) before each run.

## Other gates observed locally

- `pnpm typecheck` — pass
- `pnpm lint` — pass
- `node scripts/license-gate.mjs` — 752 packages, 750 allowed, 2 documented
  exceptions (`map-stream`, `thirty-two`), **0 rejected**
- `pnpm format:check` — run after this note was written (see PR)

## §23 outcome

reference-auth-app 14/14 MET · vulnerable-auth-app 13/14 MET, §23.12 UNMET
(test gap, filed as #109). Full table in `docs/_slice-notes/M1-EXIT.md` §6.
Verdict recorded: **M1 does not exit** pending §23.12 Express coverage — the
integrator's call on this evidence.
