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

Do **not** park binaries here. A note is folded in and deleted at merge, so any
trace or screenshot it points at would be orphaned; retained artifacts belong in
[`docs/evidence/<SLICE-ID>/`](../evidence/README.md).

The CI `Verify slice notes` step enforces two things: the directory is
`_slice-notes` with a **hyphen**, and every note carries all six numbered
sections from `_TEMPLATE.md`. Both failures happened in the first parallel batch
and neither was caught reliably — three agents wrote `_slice_notes`, and the
format gate only flagged it when the note also happened to be prettier-dirty.
