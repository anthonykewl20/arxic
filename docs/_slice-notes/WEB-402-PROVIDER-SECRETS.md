# WEB-402-PROVIDER-SECRETS — staged doc updates (charter §10.2)

Issue: #402 · Disposition: observed implementation (local green; CI pending — an LLM cannot assign `verified`).

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```text
| #402 | Web product release: comprehensive frontend intent campaigns and AI visual auditing | In progress; HTTP provider credentials (GLM Coding/Z.AI, Kimi, OpenRouter, custom compatible endpoints) are connectable from the dashboard at runtime and persist across restarts |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```text
| 2026-09-07 | **#402 (WEB-402-PROVIDER-SECRETS) runtime provider credentials landed.** The Models & accounts view can now connect HTTP-credential providers without server env changes or restarts: `POST/DELETE /api/provider-secrets` (session-guarded, same-origin, connection-id keyed), a `provider_secrets` SQLite table in the state database, and a `Workbench.effectiveEnv()` seam that layers stored credentials under the explicit operator environment for model connections, catalog refresh/discovery and job launching (`executionEnvironment`/`modelEnvironment`/`loginEnvironment`). The provider panel renders a password input for `secret: 'missing'` connections and a connected badge + remove control for `secret: 'configured'`; values are never echoed to the browser (only configured/missing state), and set/remove actions are audited (`provider.secret-set`/`-removed`, subject = the reference name). Real-world proof: real `startWorkbench` HTTP journeys (provider-secrets.real-world.test.ts) — 401 unauthenticated, 400 unknown/credential-less/empty/oversized values, set → `configured` without restart → persists across close/reopen → delete → `missing`; a real local HTTP provider requiring `Authorization: Bearer` refuses catalog discovery before the credential is stored and discovers its two-model catalog after, with the observed bearer asserted and both response bodies asserted free of the secret value; a job-env test resolves the stored credential into `ARXIC_MODEL_API_KEY`/`ARXIC_MODEL_BASE_URL`/`ARXIC_MODEL_BILLING_MODE`. Red first at `487b198e` (no `/api/provider-secrets` route → 404). Boundaries disclosed: the server-default connection (`ARXIC_MODEL_BASE_URL` + `ARXIC_MODEL_API_KEY`) stays operator-env-only; stored values are plaintext in the 0600 state database like the rest of the workbench state; `ARXIC_SECRET_*` values set in the operator environment keep precedence over stored ones. Gates local: apps/web typecheck ☑ · eslint ☑ · vitest provider-secrets 4/4 ×3 ☑ · model-connections/model-catalog/http/execution 24/24 ☑ · provider-ui + agent real-browser suites ☑ · format ☑ (full repo after note); CI on the PR head is the remaining gate. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```text
- WEB-402-PROVIDER-SECRETS runtime provider credentials (#402): HTTP provider connections (GLM Coding/Z.AI, Kimi Coding, OpenRouter, Grok-via-OpenClaw and custom compatible endpoints) can be connected from Models & accounts by pasting the API key — no server environment change or restart; the credential persists in the state database, feeds model catalog discovery and job execution through an audited effective-environment seam, is removable from the same view, and its value is never returned to the browser (only connected/missing state).
```

## 4. `VERSION` bump required?

No — the fold integrator owns `VERSION`; the user-visible capability rides the next integrator fold of the current `0.0.301` line.

## 5. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/provider-secrets.real-world.test.ts` — real `startWorkbench` HTTP servers, real session-cookie flow, real close/reopen restart persistence, a real local HTTP provider endpoint with real `Authorization: Bearer` verification, and the real `modelEnvironment` job seam.
- Browser proof: `apps/web/src/__tests__/provider-ui.real-world.test.ts` (second journey) — real dashboard in a real browser: masked connect input, connected badge, auto catalog discovery after connecting, key value asserted absent from the whole DOM (and the provider's 401 body never surfaced), removal returns the input; masked-viewport captures + sanitized timeline gated on `ARXIC_PROVIDER_EVIDENCE_DIR`.
- Artifacts: `docs/evidence/WEB-402-PROVIDER-SECRETS/green.txt` — final 3× repeated full-suite run `Tests 4 passed (4)` plus the changed-area regression suites. Red record: commit `487b198e`.
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (4/4 ×3 + 24/24 regressions + 2/2 provider-ui real-browser) ☑ · license gate → CI.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                | Expected disposition                                                                  | Test                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------ |
| Unauthenticated `POST /api/provider-secrets`           | 401 before any state change                                                           | `rejects unauthenticated…`                 |
| Missing/unknown connection id                          | 400 `Selected model provider is not configured on this server`                        | same test                                  |
| Connection without a credential ref (host-cli presets) | 400 `does not use a connectable server credential`                                    | same test                                  |
| Empty/whitespace/oversized(>5000)/non-string value     | 400; nothing persisted, `secret` stays `missing`                                      | same test                                  |
| `DELETE` for an unknown connection                     | 400                                                                                   | same test                                  |
| Secret value leakage                                   | Value absent from every response body (state, secret-save, catalog refresh)           | all three journey tests                    |
| Catalog discovery without the credential               | Error preserved verbatim (`The provider credential is not configured on this server`) | `discovers a real local provider catalog…` |
| Server restart                                         | Stored credential survives (durable in the state database)                            | journey restart leg                        |
