# FIX-360B-run3-restore — staged doc updates (charter §10.2)

Issue: #360 · PR: pending (created by this task after this note) · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #360 | [FIX-360] validate-records.ts secret-scanning alignment (directus dg12-hostbound-run3; refs #256, #358) | ☑ done (PR #361 code + FIX-360B run3 restore PR) — aligned validator proven zero-findings over the quarantined run3; run3 + zero-spend ledger entry + environ-proof restored to the evidence tree byte-identically to the gate-branch restore (dg12-exit-gate @ 3b9673d/5e59c77); docs/evidence lint/format immutability ignores mirrored from 0e93b28 |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-03 | **#360 (FIX-360B-run3-restore) directus dg12-hostbound-run3 restored after zero-findings validator proof.** AC-2 of the validator-alignment gate-finding: the aligned `validate-records.ts` run over the quarantined run3 material reports `secretFindings: 0` (run3 dir alone: records 0/findings 0/problems 0, exit 0; full material incl. record + environ-proof + verification artifacts: findings 0; exact staged final tree incl. spend-ledger with the run3 zero-spend entry: records 1/ledgers 1/findings 0/problems 0, exit 0). Honest disclosures: the invocation over the whole quarantine `runs/` dir aborts with ENOENT on run1/run2/run3's dangling `.arxic-verification-suite/node_modules/@playwright/test` symlinks (targets removed with the dead `.worktrees/dg12-exit` worktree; zero content bytes behind them — validator-walker limitation, code change out of this slice's scope); the record-only subtree scan reports the expected Finding-2 `unaccounted` problem until the parent ledger is in scope; `incompleteByDesign: 1` is the owner-pending groundedness spot-check. Restored `docs/evidence/DG-12/directus/runs/directus-dg12-hostbound-run3.json` + 44-file run dir + `.environ-proof.json` byte-identical to the gate branch's own restore of the same run (46 files; exclusions: the dangling node_modules link and volatile `test-results/.last-run.json`, both gitignored classes), plus the run3 zero-spend ledger entry (mirrors 5e59c77; recordedAt = run3.completedAt) and the `.prettierignore`/`eslint.config.mjs` `docs/evidence/` immutability ignores (mirror 0e93b28 byte-for-byte). Koel-on-main precedent verified NOT a drop decision — koel quarantine copies match main exactly (its runs blocked at stage 4 and never produced compile/verify outputs). Not restored (out of AC scope, live on the gate branch / quarantine): run1/run2/run4, `promoted/`, `runs/verification-artifacts/`. Red-first sanity: intent-proposal-spike 94/94 incl. the PR #361 source-vs-credential alignment tests. **M? ?/?.** Next: integrator merges; #360 closes only on the gate branch reconciliation. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### internal`

```
- FIX-360B-run3-restore (#360): restore the quarantined directus dg12-hostbound-run3 evidence (run record, 44-file run directory, environ-proof sidecar, zero-spend ledger entry) to `docs/evidence/DG-12/directus/` after the aligned validator proved zero secret findings over the exact staged tree; machine-recorded `docs/evidence/` bytes are now excluded from prettier/eslint rewriting (immutable evidence; mirrors the DG-12 gate-branch decision).
```

## 4. `VERSION` bump required?

no — evidence-tree restoration plus lint/format ignore scoping; no user-observable capability change (the validator behavior change itself was PR #361, whose note already declared the 0.1.2 bump).

## 5. Evidence pointers

- Real-world proof: aligned validator over (a) quarantined run3 dir `/tmp/fix-360b/run3-material/directus-dg12-hostbound-run3` → `secretFindings: 0, problems: 0`, exit 0; (b) full run3 material (record + environ-proof + `directus-dg12-hostbound-run3-verification-artifacts/`) → `secretFindings: 0` (problems: 1 expected Finding-2 subtree artifact); (c) exact staged final tree (arxic.yaml + spend-ledger with run3 entry + runs restore) → `records: 1, ledgers: 1, secretFindings: 0, problems: 0`, exit 0. All outputs pasted verbatim in the PR body.
- Restore provenance: all 46 restored files byte-identical to `origin/dg12-exit-gate` blobs (commit 3b9673d) AND to the quarantine copies at `/home/soultransit/devtony/thirdparty-dg/dg12-quarantine/directus/runs/` (verified with `cmp`); ledger entry mirrors gate-branch commit 5e59c77; lint/format ignores mirror 0e93b28 byte-for-byte (`git diff origin/dg12-exit-gate -- .prettierignore eslint.config.mjs` empty).
- Gates: typecheck ☑ · lint ☑ · format ☑ (after this note; `docs/evidence/` now ignored per immutability rule) · test (intent-proposal-spike 94 passing incl. validate-records-argv 11) ☑ · license gate (not run locally; no dependency change, CI-owned) ☐

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                                                    | Expected disposition                                                                                             | Proof                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validator invoked over the whole quarantine `runs/` dir — dangling `node_modules/@playwright/test` symlinks (dead targets) | blocked — walker `stat()` ENOENT abort; reported honestly, NOT worked around by code change (out of slice scope) | Verbatim crash output in PR body; re-run over run3 material with only the dead links excluded → `secretFindings: 0`                                  |
| Run-record subtree validated without its parent spend-ledger                                                               | blocked — Finding-2 `unaccounted` problem fires (records 1, problems 1) until the ledger joins the scan scope    | Run (b) output in PR body; resolved by staged-tree run (c) with the run3 zero-spend ledger entry (`records: 1, ledgers: 1, problems: 0`)             |
| `groundednessSpotCheck: pending` in the restored record                                                                    | observed — counted `incompleteByDesign`, never `complete`; an LLM may not self-grade                             | Validator output (c): `incompleteByDesign: 1`                                                                                                        |
| A real persona-value leak in the restored material                                                                         | blocked — exact-value + pattern-class scanning stays fail-closed on credential-bearing payloads                  | Red-first PR #361 tests re-run green (source-bearing passes / credential-bearing flags); zero findings over 123 MB of real run3 bytes incl. binaries |
