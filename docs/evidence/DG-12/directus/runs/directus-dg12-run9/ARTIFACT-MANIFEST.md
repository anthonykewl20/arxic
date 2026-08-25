# Run artifact curation

Committed: run.json, config.json, diagnostics.jsonl, intents.json, plan.md,
playwright.config.ts, stages/*, artifacts/{00,03..13}.json (raw 01/02 dumps
excluded per standing curation; shas live in stages/*.json), fixtures/*,
tests/*.

Run context: campaign round 9 (post-#314 adaptive masks, PR #315).
HONEST OUTCOME: the FIRST verification run PASSED end-to-end on the real
directus login — formScope bound, fills landed, URL asserted, and the
checkpoint screenshot CAPTURED with the adaptive landmark mask (run-7's
locator failure and run-8's mask-inventory failure are both gone). The
gate still blocked because run 2 lost a mount race: probed live, the
directus SPA renders ZERO landmark elements immediately after goto (the
Vue app mounts the login form milliseconds after the load event), so the
run-2 capture saw nothing maskable and failed closed exactly as designed.
Filed as the #314 follow-up (bounded wait-for-landmark before concluding
nothing is maskable). Verification policy requires 2 clean runs, so AC-4
is NOT yet satisfied — round 10 after the follow-up lands.
