# Run artifact curation

Committed: run.json, config.json, diagnostics.jsonl, intents.json, stages/*,
artifacts/* (excluding any raw scanner dumps per standing curation; shas in
stages/*.json).

Run context: campaign round 15 — koel confirmation lane (post-#319+#321).
HONEST OUTCOME: blocked, by TWO NEW per-item semantic-gap blockers (not the
boundary-hold class):
- stage 9 (workflow-compiler): ARXIC-ORCH-PROPOSAL-SURFACE-MISSING — one
  proposed route /api/podcasts/:param/subscriptions has no labelled form on
  the crawl surface; that ONE unverifiable proposal blocks the whole run.
- stage 13 (domain-inventory): ARXIC-INVENTORY-PROVIDER-INCLUDE-UNRESOLVED
  (2) — Laravel provider include gaps (runtime-computed include paths,
  no enclosing Route::group) block the inventory stage.
Both contradict ADR-008 Decision 2 (every row gets an explicit disposition;
inventory completeness is separated from replayability; no row needs to
block). Filed as F-E13. Coverage context: 315 rows, 146 covered, 133
proposals — the run itself never reached verification.
