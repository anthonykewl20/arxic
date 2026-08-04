# Test fixture apps

These are real applications used as Arxic's non-synthetic test surface.

Start the real Mailpit SMTP/API service, then run the reference app integration test:

```sh
docker compose -f test-fixtures/docker-compose.yml up -d
pnpm --filter reference-auth-app test
```

The reference app defaults to port `4012` in tests. Override it with `ARXIC_TEST_PORT` or `PORT`; configure its advertised origin with `ARXIC_TARGET_ORIGIN`, SQLite file with `ARXIC_DB_PATH`, Mailpit SMTP with `ARXIC_MAILPIT_SMTP`, and Mailpit API with `ARXIC_MAILPIT_API`. If the default Mailpit host ports are occupied, set `ARXIC_MAILPIT_SMTP_PORT` and `ARXIC_MAILPIT_API_PORT` when starting Compose and use the matching app/test variables.
