# `docs/_slice-notes/` — staged doc updates for parallel slices

Staging area required by [`engineering-charter.md` §10.2](../engineering-charter.md).

While slices are being built concurrently in separate worktrees, a slice branch
**must not** edit `docs/SYNC.md`, `CHANGELOG.md`, or `VERSION` — those three files
would conflict on every branch, and `🔖 RESUME HERE` is single-writer.

Instead, each slice adds exactly one file here, named for its slice id
(`M1-11.md`, `M1-14.md`, …), using `_TEMPLATE.md`. The integrator folds the notes
into `docs/SYNC.md` + `CHANGELOG.md` in merge order and deletes them.

**This directory must be empty (apart from `README.md` and `_TEMPLATE.md`) on
`main` before any milestone exit.** A leftover note means a doc sync was never
folded in — the same defect as a stale `SYNC.md`.
