# Intent Ledger schema

`intent-ledger.schema.json` (JSON Schema 2020-12, closed — `additionalProperties:
false` at every level) validates the ADR-008 Decision 1 product artifact: the
intent ledger written at the run root as `intents.json`, shipped hash-covered in
every promoted bundle (local lane: bundle-root file under `manifest.fileHashes`

- `checksums.sha256`; worker lane: content inside the frozen
  `promoted/RUNID.bundle.json`), and rendered read-only by `arxic intents`.

Key invariants the schema pins:

- `schemaVersion` is the constant `arxic-intent-ledger-v1`.
- Every ledger row is grounded: `evidence.sourceRefs` embeds line-anchored
  `EvidenceRef`s (validated against the canonical
  [`evidence-ref.v1.json`](../evidence/evidence-ref.schema.json)) and every
  intent's `evidenceRefIds` use the `src:<path>:<start>-<end>` grammar from the
  Domain Inventory consumer projection.
- `truthState` uses the contracts enum; `replayStatus` is
  `not-attempted` / `attempted:passed` / `attempted:failed` /
  `attempted:blocked`. The schema accepts the values; the BUILDER is what
  guarantees `verified` is only ever derived from deterministic verifier output
  artifacts (ADR-001 §2), never from model output.
- `oracleKinds` are the ADR-004 oracle provenance kinds:
  `domain-rule`, `repository-specification`, `human-approved`, `observed-only`.

Validation failures surface as stable `ARXIC-INTENT-LEDGER-*` diagnostics
(`ARXIC-INTENT-LEDGER-SCHEMA-INVALID`, `ARXIC-INTENT-LEDGER-VERSION-UNKNOWN`).
