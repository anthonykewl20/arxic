# Run artifact curation

Committed: run.json, config.json, diagnostics.jsonl, intents.json, artifacts/
{00,03..13}.json, stages/* — every artifact the DG-12 exit gates consume
(coverage: 13; grounded: 13+intents; replay: 10; determinism: 13/04/09).

Excluded from the commit (raw source-scan event dumps, 99% of the run's bytes;
no gate reads them): artifacts/01.json, artifacts/02.json. They remain in the
operator's local tree during the campaign window. Nothing else was altered.
