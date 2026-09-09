# WEB-402-PAID-INFERENCE — funded GLM campaign on the real reference app

Owner-unblocked proof for #402's "fresh paid inference proof" gap.

## Run

- Credential: `ARXIC_SECRET_GLM_CODING_KEY` from the live workbench's Models &
  accounts secret store (GLM Coding / Token Plan, preset `glm-coding`,
  `https://api.z.ai/api/coding/paas/v4`), read in-process by
  `scripts/paid-inference-campaign.mts`, never printed or persisted; value
  fingerprint `7694ef46cce6` (first 12 hex of its SHA-256 — the record cannot
  contain the value).
- Model: `glm-4.7` (the owner's configured model), budget capped at \$0.025.
- Target: the REAL reference-auth-app (real build, real server, seeded
  per-pass-login persona `paid-proof@example.test`).
- Scope: ONE selected row — `GET /login` — through the real engine:
  source inventory → crawl → REAL PAID GLM proposals → compilation → two
  deterministic verifier replays in real Chromium.

## Result (from campaign-record.json, sanitized: 16 redaction markers)

- Run state `completed`, outcome **`verified`** — "The existing deterministic
  verifier passed this candidate."
- Ledger: 9 rows (8 extracted, 1 unextracted-with-reason), 5 grounded intents;
  the `GET /login` row is **`verified` / `attempted:passed`** with
  `repository-specification` oracles; 4 `attempted:passed` replay markers
  (workflow replays × 2 passes).
- Truth states: one `verified`, eight `observed` — assigned by the
  deterministic pipeline only.
- Billing: the GLM Coding plan is subscription-billed, so no dollar-metered
  spend is reported by the provider; the engine's budget guard capped the run
  at \$0.025 regardless. Token counts are inside the retained run record.

## Reproduce

```
npx tsx scripts/paid-inference-campaign.mts
```

(requires the funded credential in the live workbench secret store; boots its
own fixture app and temp state; writes campaign-record.json here).
