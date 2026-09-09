# WEB-402-CLOSURE — staged doc updates (charter §10.2)

Issue: #402, #423 · PR: #545 · Disposition: mixed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #402 | [WEB-402] Web product release: frontend intent campaigns and AI visual auditing | ☑ closed as a work item — un-discharged gates recorded in `docs/release-gates/undischarged-gates.md`; no release authorized |
| #423 | [VISUAL-SLM-423] Compact CPU visual reviewer for a 512 MiB target | ☑ closed as a work item — promotion still blocked; residue recorded in `docs/release-gates/undischarged-gates.md` |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-09 (13) | **#402 and #423 closed as work items; every un-discharged gate recorded, none pretended.** The machine half of the screenshot census ran to completion: all **344** retained PNGs under `docs/evidence/WEB-402-*` rendered into 66 contact sheets and read, PNG/`.privacy.json` pairing machine-verified at 344/344 with zero orphans, **no credential, token, session value or PII observed**; capture-time masking is consistent and secret fields render env-var reference names, not values. Two non-credential findings, both `observed`: the operator's absolute home path is rendered in the `WEB-402-INSTALL` and `WEB-402-DASHBOARD-UX` admin captures (F1), and the same path is in **305 tracked files** repo-wide including four source literals — one of them the live workbench SQLite path in `scripts/paid-inference-campaign.mts` (F2). The four source literals are fixed (env override → `homedir()` → path resolved from the module's own location) and `scripts/operator-path-guard.test.mjs` now rejects new ones, red-first at 9 offenders across 4 files. Evidence and doc occurrences are left as an owner decision, not silently rewritten. The gate doc gains a "machine pre-pass" section stating plainly that it discharges nothing. `docs/release-gates/undischarged-gates.md` records all twelve remaining gates in three classes: owner-only (human screenshot inspection, home-path disposition, independent release inspection, #423 human review), credential/money-blocked (Kimi/Go/SuperGrok/OpenRouter paid inference, provider-account browser login, 512 MiB VPS), and genuinely unbuilt (state/persona/flag breadth, connection management, #423's 178-of-1,000-row corpus, chronological holdout, model promotion). **No release tag or publication is authorized by this closure.** Next: nothing open. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]`

```
- WEB-402-CLOSURE tracker closure with recorded gates (#402, #423): the #402 screenshot census's machine half is complete and retained (344/344 PNGs read, 344/344 provenance pairing verified, zero orphans, no credential/token/session/PII observed) and is explicitly recorded as a pre-pass that discharges none of the human gate. Four absolute operator-home literals in tracked source are replaced by an env override, `homedir()` or a path resolved from the module's own location — including `scripts/paid-inference-campaign.mts`, which hardcoded the live workbench SQLite file and six repo paths and could not run on any other machine — and `scripts/operator-path-guard.test.mjs` guards against new ones. `docs/release-gates/undischarged-gates.md` records every remaining release gate on #402/#423 with its blocker and its proof-of-discharge; both trackers close as work items and no release is authorized.
```

## 4. `VERSION` bump required?

no — one script portability fix plus documentation and evidence. No
user-observable product behavior changes.

## 5. Evidence pointers

- Census record: `docs/evidence/WEB-402-CENSUS-PRESCREEN/summary.md` — 344 PNGs, 66 contact sheets, per-lane counts, method, findings, and an explicit list of what it does NOT do.
- Gate register: `docs/release-gates/undischarged-gates.md`.
- Red-first proof: `scripts/operator-path-guard.test.mjs` reported 9 offenders across 4 files before the fix (`apps/web/src/__tests__/visual-koel-login.real-world.test.ts:21`, `apps/web/src/compact-visual/corpus-capture.ts:77`, `packages/intent-proposal-spike/scripts/surface005-crawl-harness.ts:257`, `scripts/paid-inference-campaign.mts:19,21,35,47,53,80`), 3/3 green after.
- Gates: typecheck ☑ · typecheck:packages ☑ · lint ☑ · format ☑ · test ☑ · license gate ☑ (required CI)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                      | Expected disposition                                                                                        | Test                                          |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| A new absolute `/home/<user>/` literal in `apps/`, `packages/` or `scripts/` | guard fails, reporting `file:line` only — never the matched text, which is the leak itself                  | `scripts/operator-path-guard.test.mjs`        |
| The redaction fixture `/home/private/` the trace sanitizer needs literal     | allowed by an explicit one-entry allowlist, and the file is asserted to still be in scan scope              | `scripts/operator-path-guard.test.mjs`        |
| A broken glob that would make the guard pass vacuously                       | fails — the scanned set is asserted non-empty (>100 files)                                                  | `scripts/operator-path-guard.test.mjs`        |
| An LLM attempting to discharge the screenshot gate                           | refused by the gate document itself; the pre-pass section states it discharges nothing and stays `observed` | `docs/release-gates/screenshot-inspection.md` |

## 7. What this slice does NOT do

- It does **not** discharge the human screenshot-inspection gate, the #423 human
  inspection, or any credential/purchase-blocked item. All are recorded, not closed.
- It does **not** rewrite the 305 tracked files (evidence JSON, run manifests, docs)
  that carry the operator path. That is already-published public history; the
  disposition is an owner decision, recorded as F1/F2.
- It does **not** execute `scripts/paid-inference-campaign.mts`. That needs the
  funded credential and the live workbench store; the fix is verified by typecheck
  and lint only, and the script's behavior on the operator's own machine is
  unchanged (`homedir()` reproduces the previous absolute path exactly).
- It does **not** commit the contact-sheet tiling tool. Adding a script to
  `scripts/` requires the charter's test bar; porting it to Node/`sharp` with a
  deterministic sheet-count test is a recorded follow-up.
- It pre-screened only the 344 PNGs under `docs/evidence/WEB-402-*`. The wider
  `docs/evidence/` tree holds 1,460.
- It does **not** attempt #423's chronological holdout. The third-party roots
  are present on this host (verified), so data is not the blocker; the blocker
  is that `cli.ts corpus` always retrains and has no evaluate-only mode to score
  a fresh capture against the already-trained artifact. Recorded in
  `docs/release-gates/undischarged-gates.md` §C4 as its own slice.
