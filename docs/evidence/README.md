# `docs/evidence/` — retained real-world proof artifacts

One directory per slice id (`M1-15/`, …) holds small artifacts a reviewer would
otherwise have to regenerate. Retained Playwright artifacts are
privacy-preserving action timelines, not raw/full-fidelity traces: each `*.zip`
must be produced by `@arxic/playwright-trace-sanitizer`, have an adjacent
`*.sanitization.json` sidecar, pass independent inspection, and load in the
pinned Trace Viewer. Raw trace ZIPs must never be committed, attached to a PR or
issue, assembled, or promoted.

The sanitizer retains fixed context and completed action metadata only. It
omits network/frame snapshots, resources and screencasts, DOM, sources, stacks,
attachments, logs/stdio, errors/results, free-form params, source identifiers,
and source-derived filenames. The timeline is useful for action-order review;
it is not replay-, DOM-, screenshot-, source-, or network-complete proof.

Named screenshots need a capture-time privacy policy of their own. Mask
identity/credential locators or capture a state that contains no such text,
record the mask policy in adjacent provenance, and visually review the result.
Do not infer pixel privacy from a trace byte scan and do not post-process pixels.

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

The current tree and all future evidence paths must satisfy this policy.
Historical commits containing raw trace bytes remain a disclosed pre-public
history-purge obligation; this policy does not authorize or claim a history
rewrite.
