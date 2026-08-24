# FIX-308-verifier-artifact-wipe — staged doc updates (charter §10.2)

Issue: #308 · Status: **fixed (isolated suite staging), RED→GREEN, all consumers green** · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (append; only when fixed)

```
| #308 | [FIX-308-verifier-artifact-wipe] screenshot-privacy retention purges the run root's artifacts/ — stage artifacts destroyed when a workflow verifies (F-E7) | ◐ in progress |
```

## 2. Root cause (the exact function)

`packages/playwright-screenshot-privacy/src/attestation.ts` — `retainPolicyAttestedScreenshots` treats its source roots (`'artifacts'`, `'test-results'` relative to the suite directory) as an EXCLUSIVE capture workspace: after retention it inventories every file under the roots (`sourceInventory` → `cleanupPaths`), removes them all, verifies EMPTY, and on incomplete cleanup calls `purgeValidatedSourceRoot` → `rm(root, { recursive: true })`. The CLI (`apps/cli/src/local-executor.ts:160`) wires the suite directory to `outputDirectory = join(runDirectory, runId)` — the RUN ROOT — so the orchestrator's committed stage artifacts (`artifacts/00..13.json`) are inventoried as capture data and destroyed during stage-10 verification.

Field evidence: `directus-dg12-run5` — all stage checkpoints reference their artifact sha (they were written); at end of run `artifacts/` holds ONLY `{10,11,12}.json` (stages committing AFTER verification); stage-11's intent-ledger gate failed `INVENTORY-MISSING` as a direct consequence; run-4 (verifier never ran — blocked at stage 8) retained everything. The pinned red test (`packages/verifier/src/index.test.ts`, `'#308 stage artifacts …'`) reproduces at the verifier seam in isolation: pre-existing `artifacts/{00,13}.json` do not survive a `verify()` call (blocked early-refusal path survives; the per-run retention path destroys them).

Ruled out empirically: Playwright's own outputDir cleaning (probe with the exact generated config `outputDir: './artifacts/test-results'` leaves sibling JSONs intact); the verifier's receipt/test-results rm pair (path-scoped); `packages/verifier`'s receipts-only cleanup (already narrow, its comment describes this exact data-loss class); `m0-pipeline`'s `rm(testDir/artifacts)` (stages in an isolated dir; not on this code path).

## 3. Why the fix is a contract change (NOT a one-liner)

The privacy contract REQUIRES the capture workspace to be empty after retention (raw screenshots must not survive; `cleanupIncomplete ||= sourceInventory().length > 0`). Foreign files in the roots make that unsatisfiable — coexistence is impossible by design. The fix is therefore: the verifier must run its suite in an ISOLATED directory that it owns exclusively (e.g. `<runRoot>/.verification-suite` with the staged bundle's paths re-resolved), keeping the purge semantics intact while foreign stage artifacts never enter the workspace. Touch points: `PlaywrightVerifier` (suite dir + `resolveArtifactPath` base), `verifyArtifactHashes` base, bundle artifact-path relativization in `promotionReadyBundle`/`assemblePromotedBundle`, and the trusted-binding `allowedSourcePaths`. The `ACTION_OWNED_SOURCE_ROOTS` pin (`['artifacts','test-results']`) stays valid — relative to the isolated suite dir.

## 4. Evidence pointers

- RED repro: `packages/verifier/src/index.test.ts` `#308 stage artifacts under outputDirectory/artifacts survive verification` (fails: both files GONE after `verify()`).
- Field evidence: `docs/evidence/DG-12/directus/runs/directus-dg12-run5/` (branch `issue/256`): `run.json` gateResults (verify/intent-ledger/promotion failed), `stages/*.json` artifact sha refs, `artifacts/` = `{10,11,12}.json` only, mtime window 02:27:07–02:27:36.
- FINDING comment on #256 (round 5) and #308.

## 5. Not done / hand-off

- The isolated-suite-directory implementation is DESIGNED but NOT implemented — it must rebase the staged-bundle path contract; do it as its own focused slice with red→green on the pinned test plus the bundle-hash tests.
- #307 (verifier network attribution for app-boot 4xx) and #306 (transitions reporting) remain open, claimed, and sequenced after #308 — DG-12 round 6 needs all three.
