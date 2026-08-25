# Run artifact curation

Committed: run.json, config.json, diagnostics.jsonl, intents.json, plan.md,
playwright.config.ts, stages/*, artifacts/{00,03..13}.json (raw 01/02 dumps
excluded per standing curation; shas live in stages/*.json), fixtures/*,
tests/*.

Run context: campaign round 12 (post-#319 stage-5 exemptions, PR #319).
HONEST OUTCOME: #318's fix is field-confirmed on its own seam — stage 5 no
longer emits STAGE-BLOCKED (SURFACE-001/003/008 recorded but exempt) and
stage-10 verified 2/2 again. Promotion STILL skipped, because the sticky
block originates in stages 1/2: SOURCE-BINARY-FILE (68: favicons, fonts,
PNGs), SOURCE-PARSE-ERROR (38: tree-sitter partial parses, e.g. *.test.ts),
SOURCE-UNSAFE-FILE (2: symlinks — 'Symbolic links are not source files').
Same defect class as #318 (policy-expected coverage-boundary observations
poisoning the outcome) but on the source-scanning stages, where only
UNSUPPORTED-LANGUAGE is exempt. Filed as F-E12. Round 13 after it lands.
