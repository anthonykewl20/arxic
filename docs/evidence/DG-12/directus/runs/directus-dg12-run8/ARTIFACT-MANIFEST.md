# Run artifact curation

Committed: run.json, config.json, diagnostics.jsonl, intents.json, plan.md,
playwright.config.ts, stages/* (every checkpoint), artifacts/{00,03..13}.json
(raw 01/02 dumps excluded per standing curation; shas live in stages/*.json),
fixtures/*, tests/*.

Run context: campaign round 8 (post-#312 placeholder binding, PR #313).
HONEST OUTCOME: #312 CONFIRMED IN THE FIELD — the compiled formScope now
resolves on the real directus login (labelOrPlaceholderControl present in
the spec; fills execute; run-7's toHaveCount failure is gone). The failure
moved to the NEXT layer: ScreenshotPrivacyError ARXIC-SCREENSHOT-CAPTURE-
FAILED 'declared mask locator inventory is missing or exceeds its bound'
at the checkpoint screenshot — the CLI's cliScreenshotPolicy hard-declares
masks: [{ role: main, exact: true }], and the directus admin SPA shell has
NO <main> landmark (probed live: main=0; the only landmark is the form
itself). Filed as F-E10. Downstream SCREENSHOT-INVENTORY-INVALID is the
same cascade as run 7 (the failed run never takes its screenshot).
