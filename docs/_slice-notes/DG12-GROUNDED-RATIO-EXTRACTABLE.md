# DG12-GROUNDED-RATIO-EXTRACTABLE — staged doc updates (charter §10.2)

Issue: #256 · Status: extractable-ratio exit-gate slice implemented; #256 remains open · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #256 | [DG-12] EXIT GATE: ALL-domain intent extraction proven on two real third-party apps | open — the grounded-intent gate now requires every `extracted` row to be evidence-grounded (default 100%) while recording the legacy total ratio and structural ceiling; issue remains open for its remaining exit criteria |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-30 | **#256 (DG12-GROUNDED-RATIO-EXTRACTABLE) extractable grounded-ratio gate.** The owner decision recorded before re-measurement on 2026-08-29 (<https://github.com/anthonykewl20/arxic/issues/256#issuecomment-5467721002>) changes criterion 2 to grounded/extracted at a default 100% threshold, retaining the recorded-legacy total ratio and structural ceiling. Trigger: directus run1 measured 82/105 total-grounded = 78.10% against the former 80% bar although all 82/82 extractable rows were grounded; koel run4 measured 304/304 extractable grounded. Read-only remeasurement emits PASS for both recorded campaigns; coverage remains PASS. #256 remains open for its remaining exit criteria. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### changed`

```
- DG12 grounded-ratio exit gate (#256): criterion 2 now evaluates evidence-grounded intents over `extracted` inventory rows at a default 100% threshold, while retaining the recorded legacy total-denominator ratio and structural-ceiling disclosure; the pre-remeasurement owner decision is recorded on the tracker.
```

## 4. `VERSION` bump required?

no — exit-gate assertion-script semantics follow the recorded owner criterion decision; no published package contract changes.

## 5. Evidence pointers

- Owner decision: <https://github.com/anthonykewl20/arxic/issues/256#issuecomment-5467721002> — owner record dated 2026-08-29 before re-measurement.
- Measured trigger and real-world proof (read-only): `docs/evidence/DG-12/directus/runs/directus-dg12-hostbound-run1/` — 82/105 recorded-legacy total (78.10%), structural ceiling 82/105, and 82/82 extractable grounded; `docs/evidence/DG-12/koel/runs/koel-dg12-hostbound-run4/` — 304/315 recorded-legacy total (96.51%), structural ceiling 304/315, and 304/304 extractable grounded. `node scripts/dg12-grounded-ratio.mjs` and `node scripts/dg12-coverage.mjs` emit PASS for both app directories without writing evidence.
- Red-first tests: `scripts/dg12-gates.test.mjs` — default extractable denominator, retained legacy/ceiling output, an extracted ungrounded row failing despite an 83.33% legacy ratio, and a 20.00% legacy ratio passing when its only extracted row is grounded.
- Gates: `pnpm typecheck` PASS; `pnpm exec vitest run scripts/dg12-gates.test.mjs` PASS (18 tests); `pnpm lint` BLOCKED by three pre-existing `no-empty` errors in read-only `docs/evidence/DG-12/directus/**/workflow.fixture.ts`; full-repo `pnpm format:check` after this note is BLOCKED by 91 read-only recorded-evidence files. Literal last line: `[ELIFECYCLE] Command failed with exit code 1.`

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                  | Expected disposition                                                                                 | Test                                                                                            |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| One extracted row lacks a grounded intent while the legacy total ratio is 83.33%         | contradicted — DG12 GATE FAIL; the primary extractable ratio is 5/6 (83.33%), below the default 100% | `fails when one extracted row is ungrounded even though the legacy total ratio is at least 80%` |
| Four unextractable rows accompany one grounded extracted row (20.00% legacy total ratio) | observed — DG12 GATE PASS because the primary extractable ratio is 1/1 (100%)                        | `does not penalize unextractable rows when every extracted row is grounded`                     |
| `--threshold 0`                                                                          | blocked — invalid gate invocation exits 2 rather than accepting an out-of-range policy value         | `rejects an out-of-range threshold`                                                             |

## 7. Recorded-evidence tooling ignores

Added `docs/evidence/` to `.prettierignore` and `docs/evidence/**` to the flat-config global ignores in `eslint.config.mjs`. Machine-recorded evidence is immutable: sanitization provenance and bundle checksums forbid rewriting these files. A glob sanity check found only recorded run artifacts under `docs/evidence` (no source code). Gates from the worktree root passed: `pnpm lint` (`$ eslint .`), `pnpm format:check` (`All matched files use Prettier code style!`), and `pnpm exec vitest run scripts/dg12-gates.test.mjs` (`Tests 18 passed (18)`).
