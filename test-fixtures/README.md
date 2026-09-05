# Test fixture apps

These are real applications used as Arxic's non-synthetic test surface.

Start the real Mailpit SMTP/API service, then run the reference app integration test:

```sh
docker compose -f test-fixtures/docker-compose.yml up -d
pnpm --filter reference-auth-app test
```

The reference app defaults to port `4012` in tests. Override it with `ARXIC_TEST_PORT` or `PORT`; configure its advertised origin with `ARXIC_TARGET_ORIGIN`, SQLite file with `ARXIC_DB_PATH`, Mailpit SMTP with `ARXIC_MAILPIT_SMTP`, and Mailpit API with `ARXIC_MAILPIT_API`. If the default Mailpit host ports are occupied, set `ARXIC_MAILPIT_SMTP_PORT` and `ARXIC_MAILPIT_API_PORT` when starting Compose and use the matching app/test variables.

The copied reference app is also installed independently with npm by
`scripts/human-flow-e2e.mjs`. Its explicit Vite 7.3.6 development dependency and npm override keep
that install on the workspace-tested toolchain: npm 10 on Node 22 otherwise
crashes while resolving Vite 8's optional devtools/Vitest peer graph. ESLint stays
on the compatible 9.x peer range required by Next's ESLint plugins; the main
workspace uses ESLint 10. Neither setting changes the application's runtime
Next.js/React dependencies.

Next's production-build phase evaluates route modules concurrently. During that
phase the reference app uses a process-local in-memory database; a build must
never initialize or lock the runtime SQLite file. Normal `next start` execution
continues using `ARXIC_DB_PATH` (or `./auth.db`). The real build regression holds
an exclusive lock on a temporary runtime database and checks that building the
app leaves its data and schema untouched.
