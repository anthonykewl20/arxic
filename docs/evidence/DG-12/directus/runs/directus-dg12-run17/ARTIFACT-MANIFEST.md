# Run artifact curation

Committed: run.json, config.json, diagnostics.jsonl, intents.json, plan.md,
playwright.config.ts, stages/*, artifacts/{00,03..13}.json, fixtures/*,
tests/*, ../promoted/directus-dg12-run17.bundle.json (+ directory form).

Run context: campaign round 17 — one of the SAME-CODE determinism pair
(run17 + run18, post-#323 tree). Outcome verified, status completed,
promotion reached (again). Purpose: ADR-008 exit criterion 6 (byte-stable
repeat ledgers) and criterion 3 (replay ratio across two clean runs).
dg12-determinism.mjs run17 vs run18: PASS (model-sampling intent-text
variance honestly OBSERVED-attributed by the script); dg12-replay-ratio.mjs:
2/2 = 100% (threshold 90%) PASS. The shared retention root
(verification-artifacts/) holds run-18 bytes after the pair; each run's own
stages/*.json carries its shas.
