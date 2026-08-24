# Run artifact curation

Committed: run.json, config.json, diagnostics.jsonl, intents.json, artifacts/
{00,03..13}.json, stages/* — every artifact the DG-12 exit gates consume
(coverage: 13; grounded: 13+intents; replay: 10; determinism: 13/04/09).

Excluded from the commit (raw source-scan event dumps, ~99% of the run's
bytes; no gate reads them): artifacts/01.json, artifacts/02.json. They remain
in the operator's local tree during the campaign window. Nothing else was
altered.

Run context: campaign round 4 (post-#303 placeholder addressing + #304 front
fixes). Honest outcome: blocked at the exploration fills — but the two prior
blockers are GONE: no ARXIC-SURFACE-009 (the crawl-tier replay login
succeeded through the fixed front), and the plan lane composed and navigated
/admin (the #299 fix). The remaining blocker is a NEW measured defect: the
DG-08 formScope filter counted scoped forms once with no settle, and the
navigate observation lands mid-re-render on the real login (t0 scoped form =
0, t+300ms = 1) — every fill/submit failed closed semantic-ambiguous.
Reproduced deterministically 4/4 through the front; remediation is PR #305
(#301 follow-up). Round 5 re-runs after it lands.
