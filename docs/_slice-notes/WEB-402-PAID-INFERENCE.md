# WEB-402-PAID-INFERENCE — staged doc updates (charter §10.2)

Issue: #402 · PR: #532 · Disposition: verified (the deterministic verifier assigned it; no LLM did)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
(No milestone row — #402 slice; record under the #402 status paragraph.)
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-09 | **#402 (WEB-402-PAID-INFERENCE) funded GLM campaign DONE — outcome `verified`.** Owner-unblocked: the funded `ARXIC_SECRET_GLM_CODING_KEY` (GLM Coding / Token Plan) was read in-process from the live workbench's Models & accounts secret store (fingerprint 7694ef46cce6; never printed or persisted) and drove ONE bounded campaign through the real engine against the REAL reference-auth-app — model glm-4.7, \$0.025 budget cap, per-pass-login persona with a seeded real account, single selected row GET /login. Result: run completed with outcome **verified** — real paid GLM proposals, compilation, and TWO deterministic verifier replays passing in real Chromium; ledger 9 rows / 5 grounded intents; the GET /login row verified / attempted:passed with repository-specification oracles. Subscription billing means no dollar-metered spend; the record retains provenance (16 redaction markers guard the credential). Reproducible via `scripts/paid-inference-campaign.mts`. The fresh paid-inference gap on #402 is discharged; the human screenshot census remains the owner's outstanding gate. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### <added|changed|fixed|security|internal>`

```
### Added

- WEB-402-PAID-INFERENCE funded-inference proof runner (#402): `scripts/paid-inference-campaign.mts` runs a bounded real-engine campaign (model glm-4.7 via the GLM Coding plan, \$0.025 cap, one selected row) against the real reference app with the funded credential read in-process from the live workbench secret store — producing the retained `verified` campaign record under `docs/evidence/WEB-402-PAID-INFERENCE/` (sanitized; credential never persisted).
```

## 4. `VERSION` bump required?

no (proof tooling, not a user-observable product change)

## 5. Evidence pointers

- `docs/evidence/WEB-402-PAID-INFERENCE/{campaign-record.json,summary.md}` — the sanitized run record (outcome verified; ledger; replay markers; provenance) and the run description with reproduction steps.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                            | Expected disposition                                                                          | Evidence                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------- |
| credential absent from the store   | runner refuses before any spend                                                               | script guard                     |
| credential leakage into the record | impossible-by-construction redaction + fingerprint-only logging; 16 redaction markers audited | campaign-record.json             |
| budget overrun                     | engine budget guard capped at \$0.025                                                         | execution settings in the record |
| ungrounded candidate               | deterministic verifier decides (verified here only because both replays passed)               | replay markers attempted:passed  |
