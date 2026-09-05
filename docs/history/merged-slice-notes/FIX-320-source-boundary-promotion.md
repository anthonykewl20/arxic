# FIX-320-source-boundary-promotion — slice note

Issue: #320 · Status: fixed on this branch, awaiting CI + AC-4 round-13 field proof · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #320 | [FIX-320-source-boundary-promotion] source coverage-boundary observations (BINARY-FILE/PARSE-ERROR/UNSAFE-FILE) join UNSUPPORTED-LANGUAGE in the stage-1/2 exemption — recorded diagnostics, unextracted rows still counted, real repositories can promote | ☑ done (code; AC-4 round 13 pending) |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-25 | **#320 (FIX-320-source-boundary-promotion) source coverage-boundary exemptions.** Round-12 field evidence: #318's stage-5 fix field-confirmed (no stage-5 STAGE-BLOCKED; stage-10 verified 2/2 again) but promotion STILL skipped — the sticky block originates in stages 1/2: SOURCE-BINARY-FILE (68: favicons, fonts, PNGs), SOURCE-PARSE-ERROR (38: tree-sitter partial parses, e.g. *.test.ts), SOURCE-UNSAFE-FILE (2: symlinks). Same defect class as #318 (policy-expected boundary observations poisoning the sticky outcome), one stage earlier; only UNSUPPORTED-LANGUAGE was exempt there. Fix: the three codes join the stage-1/2 exemption list — they remain recorded blocked-severity diagnostics with their counts, the domain inventory still accounts their rows as unextracted (honest-zero #250 untouched), and genuinely dangerous stage-1/2 conditions (redaction failure, hash mismatch, unknown codes) keep blocking. \`ARXIC_SOURCE_UNSAFE_FILE\` gains a package-index re-export (additive; the orchestrator imports from the adapter root). Red-first: the shared committed-source fixture gained a binary file (PNG-magic favicon.ico) + a symlink (docs-link.md → readme.md), so the EXISTING end-to-end promote test failed pre-fix at \`expected 'blocked' to be 'verified'\` — the exact round-12 condition (proven by reverting only the orchestrator rule: red, restore: green). Unit pin: the four-code family exempt on stages 1/2 ONLY (same code blocks on stage 5), REDACTION-FAILED/HASH-MISMATCH/unknown still block. **Next: DG-12 round 13 under #256 (AC-4: directus reaches stage-12 promotion).** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-320 source boundary promotion (#320): source-scanning coverage-boundary observations (binary assets, tree-sitter partial parses, symlinks) no longer block the run outcome or promotion on stages 1/2 — they join UNSUPPORTED-LANGUAGE in the exemption list, remain recorded diagnostics, and unextracted-row accounting is unchanged; genuinely dangerous and unknown stage-1/2 codes still block.
```

## 4. `VERSION` bump required?

no — orchestrator outcome-policy correction + one additive package export; no contract or schema change.

## 5. Evidence pointers

- Defect evidence: `docs/evidence/DG-12/directus/runs/directus-dg12-run12/` — stage-10 verified 2/2, stage-12 skipped ('No verified staged bundle reached promotion'), stage-1/2 STAGE-BLOCKED with the three codes (68/38/2 subjects sampled: app/public/favicon.ico, api/src/ai/mcp/server.test.ts, readme.md symlink); reported on #318 (round-12 comment) and #256.
- Fix: `packages/orchestrator-langgraph/src/orchestrator.ts` — stage-1/2 exemption extended to \`ARXIC_SOURCE_BINARY_FILE | ARXIC_SOURCE_PARSE_ERROR | ARXIC_SOURCE_UNSAFE_FILE\` (+ imports); `packages/source-ua-adapter/src/index.ts` — re-export \`ARXIC_SOURCE_UNSAFE_FILE\`.
- Red-first tests: shared fixture \`committedSource()\` in \`packages/orchestrator-langgraph/src/**tests**/sad-paths.test.ts\` gains favicon.ico (PNG magic) + docs-link.md symlink → the existing end-to-end promote test ('promotes when source and discovery blockers describe deliberately unattempted advisory work') failed pre-fix at \`expected 'blocked' to be 'verified'\` (red proven by reverting only the orchestrator rule and re-running; green on restore); NEW unit pin 'exempts the source coverage-boundary family on stages 1/2 only (#320)' — family exempt on 1/2, same codes BLOCK on stage 5, REDACTION-FAILED/HASH-MISMATCH/unknown keep blocking on 1/2.
- Gates: orchestrator-langgraph 20 files / 206 tests; verifier + cli + m0-pipeline 27 files / 266 tests; typecheck/lint clean; `format:check` after this note: `All matched files use Prettier code style!`

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                           | Expected disposition                                                                                                           | Test                                                             |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| stage-1/2 emits BINARY-FILE/UNSAFE-FILE (real-repo fixture), later stage verifies | outcome verified; promotion reached; diagnostics retained (observed, end-to-end — existing promote test with hardened fixture) | 'promotes when source and discovery blockers…'                   |
| coverage-boundary family on the WRONG stage                                       | still blocks (exemption is stage-scoped) (observed, unit)                                                                      | 'exempts the source coverage-boundary family on stages 1/2 only' |
| genuinely dangerous stage-1/2 codes (redaction/hash/unknown)                      | still block the sticky outcome (observed, unit)                                                                                | same pin                                                         |
| coverage accounting                                                               | unextracted rows still counted by the inventory (unchanged by this slice — no scanner change)                                  | existing inventory/honest-zero suites                            |

## 7. Not done / known-weak spots

- AC-4 (a directus campaign round reaching stage-12 promotion) executes as round 13 under #256 after this merges — two same-class seams have now been fixed in sequence (#318 stage 5, #320 stages 1/2); if round 13 exposes yet another sticky-block source, it files the same way.
- PARSE-ERROR is exempt from OUTCOME blocking but a parse-failed route-bearing file still yields zero intents from it — the honest-zero coverage accounting is the mitigation, and a future slice could tighten parse-error subjects to test/generated paths only (not taken: subject-based classification would be guesswork).
- The end-to-end red test relies on the shared fixture emitting the codes; the 38-subject PARSE-ERROR population from the real repo is covered by the unit pin only.
