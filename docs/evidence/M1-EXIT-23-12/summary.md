# M1-EXIT-23-12 evidence summary

Branch: `feat/m1-exit-23-12`

Tested working tree: uncommitted issue #109 slice based on
`135991d9b1a07c2ffa08e38f8e261543ec5ab980` (`origin/main` at slice creation).

Environment: Linux x86_64 · Node `v24.18.0` · pnpm `11.17.0` · Playwright
`1.62.1` · Chromium · per-run temporary sqlite databases and ephemeral app
ports · `ARXIC_MAILPIT_SMTP` / `ARXIC_MAILPIT_API` unset.

Command:

```text
ARXIC_EVIDENCE_DIR="$PWD/docs/evidence/M1-EXIT-23-12" pnpm exec vitest run packages/bundle-promoter/src/__tests__/promotion-real-world.test.ts
```

Historical WIP result: two consecutive clean-fixture invocations passed. Each
invocation reported 1 test file passed and 2 tests passed. This is not current
completion evidence and must be rerun after #111, #112, and #115.

| Fixture app           | Clean Chromium run 1 | Clean Chromium run 2 | Initial promotion | Blocked subsequent promotion | Prior bytes unchanged |
| --------------------- | -------------------- | -------------------- | ----------------- | ---------------------------- | --------------------- |
| `reference-auth-app`  | pass                 | pass                 | pass              | pass                         | pass                  |
| `vulnerable-auth-app` | pass                 | pass                 | pass              | pass                         | pass                  |

The pre-policy screenshots and raw Playwright traces were removed from this branch
because they are not safe retention artifacts. They must be regenerated through
the shared trace sanitizer and screenshot privacy policy. The historical
failed-promotion result was asserted in the test as
`blocked` with `ARXIC-PROMOTION-ATOMIC-REPLACE-FAILED`; the real public filesystem
bytes are compared directly with the bytes read after the prior successful promotion.
Before promotion, the test independently checks that the staged workflow and manifest
carry the same workflow id and `verified` status.
No retained browser artifact in this directory is currently eligible as proof.
