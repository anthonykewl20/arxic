# Run artifact curation

Committed: run.json, config.json, diagnostics.jsonl, intents.json, plan.md,
playwright.config.ts, stages/*, artifacts/{00,03..13}.json (raw 01/02 dumps
excluded per standing curation; shas live in stages/*.json), fixtures/*,
tests/*, ../verification-artifacts/verification/run-{1,2}/** (retention
root, refreshed by this run), ../promoted/directus-dg12-run14.bundle.json
(+ directory form) — the FIRST promoted bundle of the campaign.

Run context: campaign round 14 (post-#319 + #321, correctly rebased).
MILESTONE — FULL-PIPELINE SUCCESS ON A REAL THIRD-PARTY TARGET:
outcome=verified, status=completed, exit 0. Stage-10 verified 2/2 (real
Chromium replays against live directus, real persona login), stage-12
PROMOTED: receipt checksumSha256 2ac3338..., workflow prop:8177a9e9dd7bbbe1
status=verified, coverage 1/1, gates compile/policy/verify all passed,
deterministic intents ledger (intents.json) inside the frozen bundle.
The seam chain that made this possible, field-proven in order: #312
(placeholder binding), #314+#316+#317 (adaptive masks a/b/c), #318
(stage-5 boundary holds), #320 (stages 1/2 coverage boundary). AC-4 of
both #318 and #320 satisfied by this run.
