# Run artifact curation

Committed: run.json, config.json, diagnostics.jsonl, intents.json, plan.md,
playwright.config.ts, stages/*, artifacts/{00,03..13}.json (raw 01/02 dumps
excluded per standing curation; shas live in stages/*.json), fixtures/*,
tests/*. NOTE: the retained screenshot PNGs + privacy attestations for BOTH
runs live under ../verification-artifacts/verification/run-{1,2}/ (shared
retention root; committed from there) — measured ~100.0%/99.9% pure-black
pixels (adaptive landmark mask = superset-hide; the directus login form is
the page's only landmark and covers it).

Run context: campaign round 11 (post-#317 probe retry, PR #317).
HONEST OUTCOME — MILESTONE: stage-10 verification COMPLETED for the first
time on the real directus target: outcome=verified, runs 2/2 passed,
checkpoint screenshots captured + attested (masked-page) in both runs.
The full seam chain on this path is field-fixed: locator binding (#312),
mask anchor (#314), mount race (#316), probe race (#317). #314 AC-4
satisfied.

REMAINING BLOCKER (new finding F-E11, promotion structurally impossible):
stage 12 skipped — 'No verified staged bundle reached promotion'. Root
cause: run-level outcome is sticky-blocked by stage-5 diagnostics
SURFACE-001 (external link not followed), SURFACE-003 (maxDepth frontier
stop), SURFACE-008 (default-deny POST abort). diagnosticBlocksStage()
exempts only UNSUPPORTED-LANGUAGE (stages 1/2) and SURFACE-002 (stage 5);
the fixture app emits only those exempt codes, but ANY real target with
external links, deeper paths, or protected POSTs emits 001/003/008 —
policy-EXPECTED default-deny observations that poison the outcome. Filed
as the next issue; round 12 after it lands.
