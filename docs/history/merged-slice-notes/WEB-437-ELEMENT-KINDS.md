# WEB-437-ELEMENT-KINDS — staged doc updates

Issue: #437 · PR: linked from issue · Disposition: observed scoped local proof;
required current-head CI is recorded in the PR before merge. #402 remains open.

## 1. `docs/SYNC.md` — tracker row

Fold after the required CI gate passes and this slice merges:

```
| #437 | [WEB-437-ELEMENT-KINDS] Accessible captured-element type filtering | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row

```
| 2026-09-07 | **#437 (WEB-437-ELEMENT-KINDS)** bounded native/declared-role type hints, combined type/number/point filtering, keyboard controls and legacy Unknown handling. 34 changed-area tests passed; final clean-head real browser proof: 3 tests, 23 agent-viewed PNGs, five hash-checked sanitized timelines, 23 axe/reflow reports with zero violations/incomplete/overflow. Required current-head CI is recorded in PR/issue; #402 and human release inspection remain open. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### Added`

```
- WEB-437-ELEMENT-KINDS (refs #437): find captured buttons, fields, headings and other bounded types alongside number/point filters. Preserve legacy numeric inspection, reject malformed type metadata and keep hard geometry verdicts independent of browsing hints. Extend real and installed dashboard browser gates.
```

## 4. `VERSION` bump required?

Yes, user-observable filter. Integrator selects the next synchronized VERSION/package
version when folding deferred notes. This worktree does not edit shared global files;
current package/dashboard version remains 0.0.200.

## 5. Evidence pointers

- [Safe proof](../evidence/WEB-437-ELEMENT-KINDS/summary.md): real reference-app UI, independent button bounds, real dashboard classification and explicitly bounded legacy supplement.
- Final browser proof: 3 tests across 2 files, 89.48 s, clean runtime commit `68a4968`.
- Changed-area run: 34 tests across 4 files. Root/package typechecks, lint and license passed (808 packages, zero rejected).
- Full-repo format is run after this note; exact final output and current-head CI recorded in PR/issue.
- 23 screenshots reviewed in contact sheets, two originals separately; every PNG/timeline hash checked. No human release inspection performed.

## 6. Sad paths proved

| Trigger                                         | Expected disposition                              | Proof                                      |
| ----------------------------------------------- | ------------------------------------------------- | ------------------------------------------ |
| Missing image or no matching element            | Explicit retry/empty state; no invalid picking    | Both real UI themes                        |
| Unsupported type epoch or invalid kind          | Reject trusted inspector metadata                 | Parser/collector contracts                 |
| Bad browsing metadata with hard numeric failure | Hard failure remains effective                    | Numeric oracle contract                    |
| Older capture lacks type codes                  | Explicit Unknown; numeric picking/search retained | Real assessment response-format supplement |
| Native button declares radio                    | Bounded Form field hint, not Button               | Actual dashboard collection                |

Deferrals: source proof is attached; installed execution is enforced by CI, no local
437 packed run claimed. Types are hints, not computed accessibility semantics or
replay locators. No raw names/selectors are retained. No 2,000-node stress benchmark,
full browser/persona/state matrix, comprehensive UX certification or human signoff.
No existing assertion was weakened. Globals remain deferred to integration.
