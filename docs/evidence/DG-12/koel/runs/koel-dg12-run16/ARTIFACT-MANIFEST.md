# Run artifact curation

Committed: run.json, config.json, diagnostics.jsonl, intents.json, stages/*,
artifacts/* (raw scanner dumps excluded per standing curation; shas in
stages/*.json).

Run context: campaign round 16 — koel lane on post-#323 code.
#322 FIELD-CONFIRMED: outcome observed (was blocked in round 15); ZERO
STAGE-BLOCKED diagnostics anywhere; stages 0-10 ALL completed;
PROPOSAL-SURFACE-MISSING and PROVIDER-INCLUDE-UNRESOLVED (x2) now
observed-severity records; healing deferred (nothing to heal); promotion
skipped — honestly: ZERO compilable proposals (no proposal cites the single
form-backed row '/' — inference is form-blind, observedForms=[] pre-crawl).
Ledger: 315/315 rows dispositioned (304 extracted, 7 unextracted-with-reason,
4 unsupported, 0 unsafe) — ADR-008 exit criterion 1 SATISFIED on koel.
Grounding measured: 156/315 = 49.5% (criterion 2 requires >=80% owner-tuned
pre-measurement — NOT met; recorded for the exit report). Criterion 3
vacuous on koel (0 attempted replays). Form-blind inference filed as the
next finding (F-E14).
