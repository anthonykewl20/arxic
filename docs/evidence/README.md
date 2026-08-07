# `docs/evidence/` — retained real-world proof artifacts

One directory per slice id (`M1-15/`, …) holding the artifacts a slice's
real-world proof produced: Playwright traces, named screenshots, and any other
binary a reviewer would otherwise have to re-run the suite to see.

**This is a convenience record, not the proof.** The proof is the real-world test
itself, which runs in CI on every push — for example
`packages/orchestrator-langgraph/src/__tests__/exploration-real-world.test.ts`
for `M1-15/`. If an artifact here ever disagrees with what the suite produces,
the suite wins and the artifact is stale.

Keep these small. Anything a test regenerates on demand does not need to live
here; commit an artifact only when it captures something a reader cannot
cheaply reproduce, and prefer referencing the test path from the SYNC session
log instead.

This directory exists so that `docs/_slice-notes/` can stay empty between
milestones as [`engineering-charter.md` §10.2](../engineering-charter.md)
requires — slice notes are folded in and deleted at merge, but the evidence they
pointed at outlives them.
