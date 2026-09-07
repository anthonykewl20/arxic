# WEB-460-TEMPLATES — staged doc updates

Issue: #460 · PR: pending · Disposition: mixed, installed acceptance pending

## 1. `docs/SYNC.md` — tracker row

| #460 | Literal HTML/EJS discovery and unique declaration identities | In progress; final CI pending |

## 2. `docs/SYNC.md` — session-log row

2026-09-07: Literal HTML/EJS controls retain committed line/hash provenance, with explicit template/runtime gaps. Real Express source/page plus dashboard red/green exposed and corrected duplicate same-line declaration IDs that retained stale filtered rows. Eight targeted cases passed; fresh regression passed (14 tests / 5 files, 110.61 s); installed CI acceptance remains pending. #458 merged as `0785fcb7` with required exact-head CI passing (34095128927); its worktree was removed and issue closed with proof. #402 remains open.

## 3. `CHANGELOG.md` — entry under Unreleased

- Add bounded literal HTML/EJS control, action and state-attribute discovery without executing template code. Preserve explicit parser/template/runtime gaps and committed source provenance. Distinguish repeated same-line declaration identities so fresh dashboard inventories filter without stale rows. Add the real reference-page/dashboard journey to all installed acceptance modes (17 files).

## 4. `VERSION` bump required?

Yes, integrator-owned user-visible discovery improvement. No VERSION or package version mutation in this worktree. The added parse5 runtime dependency is pinned to the already locked 7.3.0 version.

## 5. Evidence pointers

- `docs/evidence/WEB-460-TEMPLATES/summary.md` and hash manifest retain source/GUI red-green evidence, masked named screenshots and adjacent sanitization provenance. No raw trace retained.
- Real reference source, actual Express page and Chromium dashboard: eight targeted tests across three files passed in 13.27 s before documentation rebase.
- Fresh regression: 14 tests / 5 files passed in 110.61 s. TypeScript and lint passed. Full-repo format after this note: `All matched files use Prettier code style!`. Installed CI is pending. License gate: 808 packages, 806 allowed, two existing exceptions, zero rejected.
- Existing EJS gap expectations now require `template-expressions-not-evaluated` instead of `unsupported-framework`; gaps remain mandatory. No count/assertion/deadline was loosened. A failed speculative dropdown change was removed.

## 6. Sad paths proved

| Trigger                                             | Expected disposition                                   | Test                                   |
| --------------------------------------------------- | ------------------------------------------------------ | -------------------------------------- |
| Malformed HTML/EJS or template code                 | Explicit gap, no invented code controls                | frontend-template.test.ts              |
| Inert/foreign/unknown-event markup or parser budget | Explicit unobserved gap                                | frontend-template.test.ts              |
| Same-line nested syntax shares label/range          | Distinct deterministic IDs, all declarations preserved | Real Express source identity assertion |
| Filter after duplicate identities                   | Exact thirteen controls, no stale condition rows       | frontend-template.real-world.test.ts   |
| Unsupported runtime semantics                       | Source stays hypothesized, coverage incomplete         | Source and real dashboard tests        |

Remaining: exact-head installed CI, historical inventories (rediscover for corrected IDs), wider theme/persona/state coverage, integrator document/version folding, full #402 and independent human release inspection. This note is not a completion claim.

Final local browser proof: Firefox 1 case / 13.09 s; WebKit 1 case / 11.65 s. Chromium regression 14 cases / 5 files / 110.61 s. All new final dashboard audits have zero violations/overflow and passing explicit checks where specified. Named capture-masked screenshots and adjacent provenance are retained in the evidence manifest.
