# DG-03 — retained real-world proof artifacts

Spike: #247 ([DG-03]) — generalized verification: observation-derived
assertions + API-level replay.

These are **sanitized convenience records**, not the proof. The proof is the
real-world suite in CI:

- `packages/verification-spike/src/__tests__/redirect-login.real-world.test.ts`
  (proof 4a — real Chromium end-to-end redirect-after-login verification)
- `packages/verification-spike/src/__tests__/webhook-replay.real-world.test.ts`
  (proof 4b — real-HTTP webhook replay with hashed evidence)

Regenerate this directory with:

```sh
ARXIC_DG03_EVIDENCE_DIR=docs/evidence/DG-03 pnpm exec vitest run \
  packages/verification-spike/src/__tests__/redirect-login.real-world.test.ts \
  packages/verification-spike/src/__tests__/webhook-replay.real-world.test.ts
```

## Files

| File                            | What it records                                                                                                                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `observation-capture.json`      | Proof 4a stage-8-style capture: post-action URL (`/dashboard`), heading anchors, a11y snapshot sha256, deterministic runtime evidence id, real Chromium version. No secrets: the record carries no persona data. |
| `api-replay-run01-webhook.json` | Proof 4b run-1 webhook step artifact: method, URL (loopback, ephemeral port), status 201, HMAC signature header retained only as `sha256:<16hex>`, redacted bodies.                                              |
| `api-replay-summary.json`       | Proof 4b outcome: `verified`, two passing runs, attested `local-test` environment class, SHA-256 of all four retained artifacts.                                                                                 |

Privacy notes: the webhook secret lives in an env var only for the duration
of the run and appears in no artifact (the retained signature is a digest of
a digest; the artifact scan would have failed the run otherwise). No
screenshots or trace ZIPs are retained for DG-03.

[DG-03]: https://github.com/anthonykewl20/arxic/issues/247
