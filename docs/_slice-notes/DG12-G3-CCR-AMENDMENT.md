# DG12-G3-CCR-AMENDMENT — staged doc updates (charter §10.2)

Issue: #256 (gate-surface slice; CCR + DECISION recorded 2026-09-04 on the issue) · PR: <fill at open> · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

Update the existing #256 tracker row's tail (post board audit) — replace:

```text
| #256 | [DG-12] EXIT GATE: ALL-domain intent extraction proven on two real third-party apps | open — issue-contract ratified (lint 8/8; targets koel @ dfec91ff + directus @ cb846b6a pending owner ratification record); campaigns DESIGNED + STAGED on branch `issue/256` @ ecfd625; staging merged as PR #294, campaign execution in flight on ad12edb — unmerged as of 2026-08-31; FINDINGS F-B (SURFACE-005) and F-C (allowedOrigins) remediated by PR #290; F-A (the replay-fixture defect #288) closed 2026-08-24 (COMPLETED) |
```

with:

```text
| #256 | [DG-12] EXIT GATE: ALL-domain intent extraction proven on two real third-party apps | open — G-3 denominator CCR + DECISION recorded pre-measurement (criterion 2 = grounded/extracted ≥80%, all-rows disclosed, reason enforcement) and the script amendment LANDED; the koel form-count-0 root-caused and fixed (#383, live-koel proof); exit campaigns re-staged (fresh koel 16/17 + directus 5/6 hostbound runs pending the operator-held model key) |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```text
| 2026-09-04 (4) | **#256 gate surface: G-3 CCR amendment LANDED.** Per the CCR + DECISION recorded on #256 BEFORE any exit re-measurement (criterion 2 operationalized as grounded/`extracted` rows ≥80% — threshold untouched; the all-rows ratio stays measured as SP-3 disclosure; every non-extracted row must carry its disposition reason), `dg12-grounded-ratio.mjs` + `dg12-lib.mjs` now compute the pass line over the extractable denominator, print the all-rows disclosure, and FAIL closed on reason-less non-extracted rows and on zero-extracted ledgers (no vacuous pass). Red-first: 3 new gate tests failed pre-amendment (directus-run3 shape, reason enforcement, zero-extracted); all 20 gate tests green post-amendment; verified against the REAL recorded directus run3 (82/82 = 100% pass, all-rows 82/105 = 78.10% disclosed — the structural ceiling that triggered the CCR). Next: exit campaigns (koel 16/17 + directus 5/6) pending the operator-held model key; ADR-008 flip strictly last. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### internal`

```text
- DG-12 gate-surface G-3 amendment (#256, per the recorded CCR + DECISION 2026-09-04): `dg12-grounded-ratio.mjs` asserts criterion 2 as grounded/`extracted` rows ≥80% (the extractable denominator) while still measuring and disclosing the all-rows ratio, failing closed on non-extracted rows without disposition reasons and on zero-extracted ledgers; proven red-first in the gate tests and against the real recorded directus run3 (82/82 pass, 82/105 = 78.10% all-rows ceiling disclosed).
```

## 4. `VERSION` bump required?

no — gate tooling, not user-facing product behavior.

## 5. Evidence pointers

- Red-first + suite: `scripts/dg12-gates.test.mjs` (3 new tests in the `dg12-grounded-ratio CCR amendment` block; 20/20 green).
- Real-artifact verification: `node scripts/dg12-grounded-ratio.mjs <directus run3 staged copy> --threshold 80` → PASS with both ratios printed (output on the PR).
- Gates: lint ☑ · typecheck ☑ · format ☑ · dg12-gates 20/20 ☑ (scripts-only change; full CI on the PR).

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                       | Expected disposition                                            | Test                                                                 |
| ------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| Non-extracted row without a reason                            | FAIL closed naming the row (blocked)                            | `fails closed when a non-extracted row lacks its disposition reason` |
| Zero extracted rows                                           | FAIL closed — ratio undefined, never a vacuous pass (blocked)   | `fails closed when zero rows are extracted`                          |
| Honest unextractable population, all grounded among extracted | PASS at grounded/extracted; all-rows ratio disclosed (observed) | `passes at 100% grounded/extracted ... (the directus run3 shape)`    |
