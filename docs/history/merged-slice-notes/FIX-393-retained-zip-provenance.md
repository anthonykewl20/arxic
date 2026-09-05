# FIX-393-retained-zip-provenance — staged doc updates (charter §10.2)

Issue: #393 · PR: (this PR) · Disposition: verified

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #393 | [gate-finding] retained-evidence ZIP inspection assumes adjacent sanitization provenance — promoted bundles pair traces/ with reports/ by design | ☑ done — `retainedProvenancePath` resolves the bundle `artifacts/traces/`+`artifacts/reports/` pairing (adjacency preserved); red-first fixture proof |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-05 (2) | **#393 (FIX-393-retained-zip-provenance) retained-ZIP provenance resolution DONE.** PR #392's CI (shard 3/4) failed the verifier's retained-evidence ZIP inspection over the DG-12 promoted bundles — the test hardcoded ADJACENT provenance while the bundle assembler BY DESIGN writes the sanitized trace to `artifacts/traces/<name>` and its provenance to the sibling `artifacts/reports/<name>.sanitization.json` (bundle-assembler.ts:160-167; redaction-gate.ts:165); no bundle had ever landed under docs/evidence on main, so the assumption was never exercised. Fix (test-only): `retainedProvenancePath` resolves the reports-sibling first for the `artifacts/traces/` layout, adjacency otherwise; no resolvable provenance keeps failing exactly as before. Red-first fixture (M1-15 sample in the bundle layout) fails `bundle-layout provenance must resolve` pre-fix, passes post-fix; missing-provenance fixture stays fail-closed; verifier suite 14/14. Next: #392 re-runs CI over the real DG-12 bundle evidence. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-393 retained-evidence ZIP provenance resolution (#393): the verifier's retained-evidence inspection now resolves a promoted bundle's trace provenance from the designed `artifacts/reports/` sibling directory (adjacency remains the fallback for verification-suite captures); inspection strictness is unchanged — a trace with no resolvable or non-verifying provenance still fails.
```

## 4. `VERSION` bump required?

no — test-only change; no published-surface behavior change

## 5. Evidence pointers

- Real-world proof: `packages/verifier/src/real-world.test.ts` — fixture reproducing the bundle layout over the retained M1-15 sample; the original red state is the PR #392 CI failure over the real DG-12 promoted bundles (run 33903162590, `test (3/4)`)
- Gates: typecheck ✓ · lint ✓ · full-repo `format:check` "All matched files use Prettier code style!" ✓ · verifier real-world suite 14/14 ✓

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                         | Expected disposition                                   | Test                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| trace under `artifacts/traces/` with reports-sibling provenance | resolved; inspection verifies bytes+provenance pairing | `resolves promoted-bundle provenance from the sibling reports directory`     |
| trace under `artifacts/traces/` with NO reports provenance      | fail-closed `TRACE_PROVENANCE_INVALID` (unchanged)     | `a bundle-layout trace with no reports provenance still fails closed`        |
| neutral archive filename with no adjacent provenance            | fails closed (existing test unchanged)                 | `does not let a neutral archive filename evade retained-evidence inspection` |
