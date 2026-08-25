# Run artifact curation

Committed: run.json, config.json, diagnostics.jsonl, intents.json, plan.md,
playwright.config.ts, stages/*, artifacts/{00,03..13}.json (raw 01/02 dumps
excluded per standing curation), fixtures/*, tests/*.

Run context: INVALID AS AN AC-4 TEST — executed on STALE code. The post-merge
rebase of this campaign branch FAILED (uncommitted verification-artifact
churn from the shared retention root), so run 13 ran pre-#321: stages 1/2
coverage-boundary codes still blocked (SOURCE-BINARY-FILE 68 /
PARSE-ERROR 38 / UNSAFE-FILE 2 + STAGE-BLOCKED stage-1/stage-2), stage-10
verified 2/2 again, promotion skipped — reproducing round 12 exactly, which
is at least a consistency check. The retention-root files it overwrote were
restored to their committed round-11 state. Spend recorded in the ledger.
Round 14 re-runs on correctly rebased code.
