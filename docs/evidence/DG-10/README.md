# DG-10 evidence — framework detection + enforced rulepack version ranges

Produced by `packages/ast-grep-adapter/scripts/measure-framework-gate.mts`
(invoked `npx tsx packages/ast-grep-adapter/scripts/measure-framework-gate.mts
docs/evidence/DG-10`, 2026-08-17) against the real installed rulepacks with the
real `sg` CLI, using the committed real-source evidence fixtures:

- `campaign-next-16.2.6/` — a **real** pnpm 11 lockfile (lockfileVersion 9.0)
  resolving `next@16.2.6` from the npm registry, regenerating the recorded
  campaign dependency pins (the original campaign monorepo is unlocatable —
  ADR-008 Exit criteria note). The cell-2 pack reproduces the **historical**
  `>=15 <16` range the campaign shipped with.
- `koel/` — `composer.json` (complete) and a `composer.lock` excerpt
  (`laravel/framework v13.24.0`) from koel/koel at
  `dfec91ff290509c622ff7cf392fb5e506841ee2b`, the commit DG-05 pinned. MIT.

## `matrix.json` — the Decision-9 four-cell matrix + waiver abuse

| Scenario                   | Verdict  | Rules run | Diagnostics (codes)   |
| -------------------------- | -------- | --------- | --------------------- |
| cell-1-accept              | accepted | 1         | `…FRAMEWORK-ACCEPTED` |
| cell-2-reject-campaign     | rejected | 0         | `…FRAMEWORK-REJECTED` |
| cell-3-unknown             | unknown  | 0         | `…FRAMEWORK-UNKNOWN`  |
| cell-4-waived              | waived   | 1         | `…FRAMEWORK-WAIVED`   |
| waiver-abuse-wrong-version | rejected | 0         | `…FRAMEWORK-REJECTED` |

Every entry carries the full sanitized diagnostics (code, severity, subject,
message), the detected frameworks with tier + line-anchored evidence refs
(blob SHA prefixes), and the waiver evidence line anchor for cell 4. The
harness **fails** if any emitted diagnostic or artifact contains the temporary
repository root or any absolute path — the same no-internal-paths invariant
`framework-gate.test.ts` asserts.

## `koel-detection.json` — real third-party Laravel detection

Detection over the real koel manifest + lock finds `laravel 13.24.0` at
**lockfile** tier anchored in `composer.lock`, and the gate evaluates
`frameworks: [laravel]` as `unknown` against the shipped packs — the exact
issue-#254 scenario, now failing fast instead of crawling and dying on a raw
ENOENT.

## CI-checked twins

`packages/ast-grep-adapter/src/__tests__/framework-gate.test.ts` and
`apps/cli/src/__tests__/framework-gate.test.ts` re-prove the same five
scenarios plus tamper/stale-range/malformed-waiver cases on every CI run;
`semver-range.test.ts` pins the range grammar (campaign shape, caret 0.x
special cases, hyphen widening, npm prerelease rule, fail-closed containment).
