# Run artifact curation

Committed: run.json, config.json, diagnostics.jsonl, intents.json, artifacts/
{00,03..13}.json, stages/* — every artifact the DG-12 exit gates consume
(coverage: 13; grounded: 13+intents; replay: 10; determinism: 13/04/09).

Excluded from the commit (raw source-scan event dumps, ~99% of the run's
bytes; no gate reads them): artifacts/01.json, artifacts/02.json. They remain
in the operator's local tree during the campaign window. Nothing else was
altered.

Run context: campaign round 3 (post-#300 plan-lane fix). Honest outcome:
blocked. directus run-3 — the plan lane composed and the exploration
navigated /admin, then fill/submit locators blocked LOCATOR-AMBIGUOUS (the
live login page is placeholder-addressed; label-only semantics — F-E3A on
#256); the crawl-tier replay login failed (SURFACE-009, cause not carried by
the diagnostic — live replica logins measure 4.4-5.8s warm, under the 10s
cap). koel run-2 — SURFACE-009 + an empty crawl shell: the koel build bakes
absolute asset origins into its HTML, so the attestation front's
origin-differing proxy CORS-kills the SPA (F-E3B on #256; harness-side).
