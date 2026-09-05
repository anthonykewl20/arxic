# issue-196-charter-gate — staged doc updates (charter §10.2)

Issue: #196 · PR: #TBD · Disposition: verified

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #196 | [issue-196-charter-gate] Charter names screenshot-inspection as a standing release gate | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-27 | **#196 (issue-196-charter-gate) Charter names screenshot-inspection as a standing release gate DONE.** Closed the last AC-4 gap: `docs/engineering-charter.md` now has a new §11 "Release gates (standing)" naming the human screenshot-inspection gate and linking `docs/release-gates/screenshot-inspection.md`, plus a one-line pointer from §8's slice-completion ritual. RELEASES.md already named the gate (line 53, checklist step 9) — unchanged, docs-only, verified by reading. #196 stays open for AC-3 (owner sign-off at next promoted release). |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### internal`

```
- issue-196-charter-gate (#196): document the human screenshot-inspection gate as a standing release gate in `docs/engineering-charter.md` §11, with a pointer from §8; closes the last AC-4 gap (RELEASES.md already named it).
```

## 4. `VERSION` bump required?

no — docs-only, not user-observable.

## 5. Evidence pointers

- Real-world proof: N/A — pure documentation edit, no code/behavior change.
- Artifacts: N/A.
- Gates: typecheck ☐ (n/a, no code) · lint ☐ (n/a, no code) · format ☑ (`pnpm format:check` run on full repo, see PR/report) · test ☐ (n/a, no code) · license gate ☐ (n/a, no code).

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                   | Expected disposition | Test |
| --------------------------------------------------------- | -------------------- | ---- |
| N/A — docs-only slice, no executable behavior to classify | n/a                  | n/a  |

> Superseded 2026-08-31: #196 closed with the gate institutionalized (RELEASES.md step 9 + charter §11) — AC-3 first human census sign-off remains owed at the first promoted release with retained screenshots. See `issue-196-closure.md` and the SYNC tracker row #196.
