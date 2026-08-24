# Run artifact curation

Committed: run.json, config.json, diagnostics.jsonl, intents.json, plan.md,
playwright.config.ts, stages/* (every checkpoint), artifacts/{00,03..13}.json
(raw 01/02 dumps excluded per standing curation; shas in stages/*.json),
fixtures/*, tests/*, plus the staged verification-suite leftovers
(.arxic-verification-suite: fixtures/tests/config — the suite copy that
survives on disk post-run under #308's isolation; node_modules symlink
excluded).

Run context: campaign round 7 (post-F-E8 per-request attribution, PR #311).
HONEST OUTCOME: the #307 network gate PASSED in the field for the first
time — no ARXIC-VERIFY-BLOCKED-NETWORK; the directus boot probe
(/auth/refresh 400 + console error) no longer gates. Stage-10 still
blocked, now on the NEXT layer: ARXIC-VERIFY-APP-DEFECT + RUN-FAILURE
(toHaveCount expected 1 received 0 on the compiled formScope) and the
downstream SCREENSHOT-INVENTORY-INVALID (the failed run never takes its
checkpoint screenshot, so the bound inventory cannot materialize).
Root cause of the count failure (traced with local probes): the directus
login form has ZERO <label> elements — its controls are placeholder-
addressed. The exploration lane binds them via the #303 label→placeholder
fallback; the COMPILER never got the equivalent — the generated spec emits
getByLabel only, so the compiled formScope matches 0 forms. Run 6's
runs[].passed were false for the same reason (the network diagnostic
masked the detail). Filed as F-E9.
