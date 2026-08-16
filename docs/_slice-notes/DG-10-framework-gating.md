# DG-10 — staged doc updates (charter §10.2)

Issue: #254 · PR: #<PR-NUMBER> · Disposition: verified

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #254 | [DG-10] Implement: framework detection + enforced rulepack version ranges | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-17 | **#254 (DG-10) framework detection + enforced rulepack version ranges DONE.** New `framework-gate.ts` service in `@arxic/ast-grep-adapter`: deterministic framework+version detection from source evidence (pnpm-lock/package-lock/npm-shrinkwrap/yarn.lock/composer.lock → package.json/composer.json → imports; EvidenceRef-anchored, npm range-grammar subset incl. caret 0.x, hyphen widening, prerelease rule) and NORMATIVE pack-range enforcement at rulepack selection (accept/reject/waiver/unknown/undetected diagnostics, `ARXIC-RULES-FRAMEWORK-*` + `ARXIC-RULES-WAIVER-INVALID`); unknown/out-of-range frameworks now fail fast at CLI config validation (`apps/cli/src/config/framework-gate.ts`, exit 2 before any crawl, no install-path leaks — `ARXIC-RULES-PACK-INVALID` sanitized); waivers are recorded operator decisions in a committed repo-root `arxic.waivers.json` bound to exact version + current pack range, fail-closed on tampering. nextjs-auth range widened `>=15 <16` → `>=15 <17` with CI evidence (rules verified against reference-auth-app next@16.3.0). Proved by the Decision-9 four-cell matrix red-first (real sg CLI, real pnpm-generated next@16.2.6 lockfile, real koel composer.json/composer.lock at the DG-05-pinned commit) + CLI gate scenarios + waiver-abuse/tamper cases; evidence in `docs/evidence/DG-10/`. Full `pnpm test` 167 files / 1394 green (orchestrator + CLI real-world untouched-logic green), tarball smoke + license gate green. **M-DG 8/11.** Next: DG-06 (#250), then DG-08 (#252). |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### changed`

```
- DG-10 framework detection + enforced rulepack version ranges (#254): rulepack `framework.versions` ranges are now normative — `@arxic/ast-grep-adapter` detects framework+version deterministically from source evidence (lockfiles first, then manifests with fail-closed range containment, then imports; line-anchored EvidenceRefs) and blocks rule selection outside the range with explicit `ARXIC-RULES-FRAMEWORK-*` accept/reject/waiver/unknown diagnostics; unknown or out-of-range `scope.frameworks` fail fast at CLI config validation before any crawl, with no install paths in diagnostics; a waiver is a recorded operator decision in a committed `arxic.waivers.json` (bound to exact version + current pack range, fails closed on tampering); `nextjs-auth` range widened to `>=15 <17` on CI evidence (rules verified against next@16.3.0). Decision-9 four-cell matrix proved with the real sg CLI, a real pnpm-resolved next@16.2.6 lockfile (campaign scenario), and real koel composer files.
```

## 4. `VERSION` bump required?

no — the ALL-Domain milestone is version-neutral by owner directive (ADR-008 Context); release version is decided at release time.

## 5. Evidence pointers

- Real-world proof: `packages/ast-grep-adapter/src/__tests__/framework-gate.test.ts` (four-cell Decision-9 matrix + lockfile-precedence + determinism, real `sg` CLI, real rulepacks, real committed evidence fixtures) · `apps/cli/src/__tests__/framework-gate.test.ts` (CLI fail-fast: unknown exit 2 pre-crawl, out-of-range exit 2, waiver proceeds, path-free diagnostics) · `packages/ast-grep-adapter/src/__tests__/semver-range.test.ts` (range-grammar unit proof).
- Third-party: real koel `composer.json` + `composer.lock` excerpt at `dfec91ff290509c622ff7cf392fb5e506841ee2b` (DG-05's pinned commit, MIT) — `laravel 13.24.0` detected at lockfile tier; real pnpm 11 lockfile resolving `next@16.2.6` (campaign shape regenerated with the real package manager; provenance in `packages/ast-grep-adapter/src/__tests__/fixtures/framework-evidence/README.md`).
- Artifacts: `docs/evidence/DG-10/matrix.json` (5 sanitized scenarios, harness asserts zero internal paths), `docs/evidence/DG-10/koel-detection.json`, regenerated via `npx tsx packages/ast-grep-adapter/scripts/measure-framework-gate.mts docs/evidence/DG-10`.
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (167 files / 1398 passing — re-run green after the §7 PR #272 P2 fix, +3 waiver/coherence pins) ☑ · license gate ☑ · tarball smoke ☑.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                  | Expected disposition                                                                                                                                            | Test                                                                     |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| next 16.2.6 vs pack `>=15 <16` (campaign)                                | blocked — `ARXIC-RULES-FRAMEWORK-REJECTED`, zero rules run                                                                                                      | `framework-gate.test.ts` cell 2                                          |
| next 17 vs shipped `>=15 <17`                                            | blocked — REJECTED, zero rules                                                                                                                                  | `framework-gate.test.ts` cell 2b                                         |
| `frameworks: [laravel]`, no laravel pack                                 | blocked — `ARXIC-RULES-FRAMEWORK-UNKNOWN` at selection AND exit 2 at CLI config validation before any crawl, no install paths                                   | `framework-gate.test.ts` cell 3/3b + `apps/cli … framework-gate.test.ts` |
| waiver for a different version than detected                             | blocked — REJECTED stands, no WAIVED                                                                                                                            | `framework-gate.test.ts` waiver abuse                                    |
| waiver recorded against a different pack range (stale after pack change) | blocked — REJECTED stands                                                                                                                                       | `framework-gate.test.ts` waiver abuse                                    |
| malformed `arxic.waivers.json`                                           | blocked — `ARXIC-RULES-WAIVER-INVALID`, waivers ignored (fail closed even when scan would be in range)                                                          | `framework-gate.test.ts` tampering                                       |
| in-range manifest + out-of-range lockfile                                | blocked — lockfile tier outranks manifest                                                                                                                       | `framework-gate.test.ts` precedence                                      |
| no version evidence at all                                               | observed — `ARXIC-RULES-FRAMEWORK-UNDETECTED`, rules run with non-enforcement on record (frozen-contract compatibility; frozen orchestrator tests depend on it) | `framework-gate.test.ts` no-evidence                                     |
| imports-only framework evidence (name, no version)                       | observed — UNDETECTED with import-tier EvidenceRef at the anchored line                                                                                         | `framework-gate.test.ts` import-graph                                    |
| accepted/waived verdicts                                                 | observed — `ARXIC-RULES-FRAMEWORK-ACCEPTED` / `…WAIVED` naming operator + reason                                                                                | cells 1 and 4                                                            |

## 7. PR #272 review fix — rulepack version bump (P2)

Independent review of PR #272 flagged that `rulepacks/nextjs/pack.json` widened `framework.versions` `>=15 <16` → `>=15 <17` while `version` stayed `0.1.0` — and since the range is normative (a waiver applies only when its `packVersionRange` equals the pack's **current** declared range, `appliesTo` in `framework-gate.ts`), the widening silently voided every waiver recorded against the old range with no version signal. Decision: the pack version is bumped `0.1.0` → `0.2.0` (semver: widening compatibility = minor; narrowing would be major, and this rule is now stated in `rulepacks/README.md`), the `rulepacks/nextjs/README.md` pin moves to `nextjs-auth@0.2.0`, and `docs/evidence/DG-10/matrix.json` was regenerated (cell-1 cites the pack version in its diagnostic). The semantics are pinned red-first in `framework-gate.test.ts` (three `PR #272 P2` tests, observed red against the un-bumped pack): a waiver recorded against the pre-widening range (`>=15 <16`, pack 0.1.0) does NOT waive next 17 against the shipped pack, only a waiver re-recorded against the current range applies (both diagnostics name `nextjs-auth@0.2.0`), and the shipped `pack.json` version+range pair plus the README pin form a coherence pin so neither side can move silently again.
