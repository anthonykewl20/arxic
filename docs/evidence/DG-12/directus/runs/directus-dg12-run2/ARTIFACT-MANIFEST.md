# Run artifact curation

Committed: run.json, config.json, diagnostics.jsonl, intents.json, artifacts/
{00,03..13}.json, stages/* — every artifact the DG-12 exit gates consume
(coverage: 13; grounded: 13+intents; replay: 10; determinism: 13/04/09).

Excluded from the commit (raw source-scan event dumps, ~99% of the run's
bytes; no gate reads them): artifacts/01.json, artifacts/02.json. They remain
in the operator's local tree during the campaign window. Nothing else was
altered.

Run context: post-F-E-remediation re-run (#297 E1+E2+E3 merged at 252e2d0;
worktree rebased). Outcome honest: partial/blocked at stage-9 with
ARXIC-ORCH-PROPOSAL-OBSERVATION-MISSING — the exploration plan lane still
selected candidates[0] blindly (see the FINDING comment on #256 and the
follow-up remediation issue). Crawl surface improved 1 route/0 forms →
2 routes/2 forms (both login-shaped; replayPersona declared, env persona
present, no ARXIC-SURFACE-009 — the replay login did not refuse).
