# Run artifact curation

Committed: run.json, config.json, diagnostics.jsonl, intents.json, stages/*
(every checkpoint), artifacts/{10,11,12}.json (the only stage artifacts that
survived — see F-E7/#308), fixtures/*, tests/*, node_modules/@playwright
(pinned suite runtime).

Excluded from the commit (raw source-scan event dumps; no gate reads them):
stages/01.json and stages/02.json remain committed ONLY as checkpoint records
— the RAW dumps artifacts/01.json + artifacts/02.json were never written to
git (this run's artifacts/01-09,13 were DESTROYED by the #308 defect before
harvest; their shas remain recorded in stages/NN.json checkpoints).

Run context: campaign round 5 (post-#305 formScope settle). HONEST OUTCOME:
the pipeline ran END-TO-END for the first time — exploration observed all
four steps on the real target, stage-9 compile PASSED, stage-10 executed two
real verification passes — then blocked on two new measured defects: F-E6
(#307: verifier network policy fails on the target's own unauthenticated
boot probe /auth/refresh 400 + console error) and F-E7 (#308: the
verification window destroyed artifacts/{00..09,13}.json — screenshot-privacy
retention purges its exclusive source roots, and the suite dir is the run
root). Round 6 requires both fixed.
