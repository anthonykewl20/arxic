# FIX-360-validator-alignment — staged doc updates (charter §10.2)

Issue: #360 · PR: pending (not created by this task) · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #360 | [FIX-360-validator-alignment] classify persisted artifact kinds before validator pattern-class secret scanning | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-01 | **#360 (FIX-360-validator-alignment) validator persisted-payload classification alignment.** Exported one source-bearing/credential-bearing classifier from the production redaction gate and used it in both the checkpointer's write-time sweep and `validate-records.ts` audit scan. Source-bearing `artifacts/01-03.json` and `13.json` retain structural validation and runtime-persona exact-value protection at write time but skip class-pattern scanning in the context-free validator; credential-bearing payloads retain every class pattern. Red-first fixture coverage proves source source-text literals pass while identical `config.json` content is found. The copied quarantined Directus run3 validator proof reports `secretFindings: 0` and `problems: 0`. Gates: targeted 22 files / 244 tests, full typecheck, lint, and format clean. **M? ?/?.** Next: PR review and CI. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-360-validator-alignment (#360): align `validate-records.ts` with production persisted-payload artifact-kind classification so source-bearing target-code artifacts do not produce password/email pattern-class false positives, while credential-bearing records retain the full secret-pattern gate.
```

## 4. `VERSION` bump required?

yes → 0.1.2, because the evidence-validator CLI's externally observable finding classification is corrected; the integrator must update `VERSION` and the root package version together.

## 5. Evidence pointers

- Real-world proof: copied quarantined Directus `directus-dg12-hostbound-run3` tree under `/tmp/opencode/fix-360-proof/input/directus/runs/`; the real validator reported `secretFindings: 0` and `problems: 0` (no UI or retained trace artifact).
- Red-first and targeted coverage: `packages/intent-proposal-spike/scripts/__tests__/validate-records-argv.test.ts` — fixture evidence tree proves source-bearing `artifacts/01.json` skips pattern classes while identical credential-bearing `config.json` reports email/password patterns; it imports the production classifier directly.
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (intent-proposal-spike 94 + bundle-promoter 75 + orchestrator-langgraph 244 passing) ☑ · license gate (not run locally; unchanged, CI-owned) ☐

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                              | Expected disposition                                                                                     | Test                                                                                                                                        |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Source-bearing target source embeds password-literal-shaped and email-shaped content | observed — class patterns do not become false-positive findings; structural validation remains active    | `validate-records-argv.test.ts` → "excludes pattern classes from source-bearing artifacts but retains them for credential-bearing payloads" |
| Credential-bearing `config.json` embeds the same content                             | blocked — email/password pattern findings remain fail-closed                                             | `validate-records-argv.test.ts` → "excludes pattern classes from source-bearing artifacts but retains them for credential-bearing payloads" |
| Production taxonomy export changes or disappears                                     | blocked — direct classifier import is type-checked by the consumer test and `validate-records.ts` import | `validate-records-argv.test.ts` → "imports the production persisted-payload classification"                                                 |
