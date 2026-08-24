# Run artifact curation

Committed: run.json, config.json, diagnostics.jsonl, intents.json, plan.md,
playwright.config.ts, stages/* (every checkpoint), artifacts/{00,03..13}.json
(stage checkpoints — ALL stage artifacts survived verification this round:
the #308 isolated-staging fix, confirmed in the field for the first time),
fixtures/*, tests/*.

Excluded from the commit (raw source-scan event dumps, 57M/56M; no gate
reads them — same curation as every prior run): artifacts/01.json and
artifacts/02.json remain represented by their sha256 in stages/01.json and
stages/02.json checkpoint records only.

Run context: campaign round 6 (post-#310 merge: #308 isolation + first-cut
#307 arming). HONEST OUTCOME: F-E7 CONFIRMED FIXED — artifacts/00..13 all
present after stage-10 (run 5 lost 00–09,13), so #308 AC-4 is satisfied by
this run. F-E6 NOT FIXED by the time-window rule: stage-10 still blocked
ARXIC-VERIFY-BLOCKED-NETWORK on the directus boot probe (/auth/refresh 400
+ console error, both runs) because the probe fires AFTER the first goto,
inside the armed window — filed as F-E8 on #307; per-request attribution
follows; round 7 re-runs.
