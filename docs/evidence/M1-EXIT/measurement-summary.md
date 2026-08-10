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

reference-auth-app 14/14 MET · vulnerable-auth-app 13/14 MET, §23.12 UNMET at this
baseline (test gap, filed as #109). The full §23 14×2 MET/UNMET/PARTIAL table now lives
in `docs/evidence/M1-EXIT-23-12/summary.md` — this file originally pointed at
`docs/_slice-notes/M1-EXIT.md §6`, which was folded in on merge and no longer exists.
Baseline verdict: **M1 does not exit** pending §23.12 Express coverage — the
integrator's call; see the supersession note below for the regenerated #109 proof.

## Supersession note (2026-08-09, updated 2026-08-10)

Issue #109's `M1-EXIT-23-12` slice supersedes the §23.12 gap recorded above. Regenerated
2026-08-10 through the now-merged safe pipeline (#111 trace sanitization, #112 bundle
integrity, #115 screenshot privacy): `packages/bundle-promoter/src/__tests__/promotion-real-world.test.ts`
drives both `FIXTURE_APPS` through compile → two-pass real-Chromium verify (action-owned
`masked-page` screenshot policy) → `projectVerifiedBundle` (#112 coherence) → promote B1 → a
blocked subsequent promotion (`ARXIC-PROMOTION-ATOMIC-REPLACE-FAILED`, no receipt) → an
independent reread asserting exact B1 byte identity. Focused suite green (2 passing, both
apps). Retained artifacts are policy-compliant (masked-page screenshots + `.privacy.json`,
sanitized traces + `.sanitization.json`) under `docs/evidence/M1-EXIT-23-12/`, with the full
§23 14×2 table in its `summary.md`. This file remains the historical baseline for the other
thirteen criteria; the integrator still owns the final `#27` gate remeasurement, and no LLM
`verified` truth state is assigned.
