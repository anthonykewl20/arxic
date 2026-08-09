<!-- PR template — every slice must satisfy this. Source of truth: docs/engineering-charter.md §6–§8. -->

## Slice

Closes #<issue number>  ·  Slice id: `<M0-03>`  ·  Milestone: `<Milestone 0 - Contracts and Spikes>`

## What & why

<!-- One paragraph: what capability this adds and why, in the domain language of the ADR. -->

## Engineering checklist (charter §3–§6)

- [ ] **Seams agreed** before testing (list them)
- [ ] **Sad paths & edge cases written RED-FIRST**, each mapped to a truth state (§2) — enumerated before happy path
- [ ] **Real-world proof**: ≥1 non-synthetic user-level test against the real reference apps + real engines (§6). No "works on my mock".
- [ ] **Evidence-driven-testing**: for UI/behavior changes, attached annotated proof (recording, or sanitized Playwright action timeline + adjacent sidecar + visually reviewed named screenshots) + a pass/fail-per-test summary to this PR + the tracker issue; no raw trace ZIP attached
- [ ] Happy path written **last**
- [ ] **Layering**: orchestration (actions) vs capability blocks (services) is explicit; no premature abstraction
- [ ] No `skip`/`fixme`/`only`, no assertion weakening, no success-by-quarantine (ADR §13.1)

## Gates

- [ ] `pnpm typecheck` green
- [ ] `pnpm lint` green
- [ ] `pnpm -r test` green
- [ ] License gate (#7) green

## Slice completion ritual (charter §8 — MANDATORY, do not skip)

> **Parallel slice?** If this branch was built in a worktree alongside other in-flight slices, charter §10.2 applies: tick the `_slice-notes` box below and leave the next three boxes to the integrator. Otherwise tick the next three and skip the `_slice-notes` box.

- [ ] **Parallel (§10.2)**: added `docs/_slice-notes/<SLICE-ID>.md` from `_TEMPLATE.md` with the SYNC tracker row, session-log line, CHANGELOG entry, and disposition — and did **not** touch `docs/SYNC.md` / `CHANGELOG.md` / `VERSION`
- [ ] `docs/SYNC.md`: flipped this slice's checkbox, moved 🔖 RESUME HERE to next slice, added a session-log line (disposition: verified / contradicted / blocked)
- [ ] **`CHANGELOG.md`: added an `## [Unreleased]` entry (Keep a Changelog verb) for this slice — ALWAYS, no exceptions**
- [ ] **Version**: if user-observable, bumped per `RELEASES.md` and `VERSION` == `package.json` `version`
- [ ] `docs/adr/`: added a dated addendum or new ADR if any decision changed (frozen §10 contracts change only via ADR)
- [ ] `docs/engineering-charter.md` updated if process changed
- [ ] Affected `packages/*/README.md`, `schemas/*`, `rulepacks/*` versions bumped
- [ ] **Staleness sweep**: `rg -n "<slice id> TODO FIXME"` — no doc still describes this as pending/planned
- [ ] PR linked to the issue; completion comment posted with dispositions + evidence pointers; **issue will be closed on merge**
- [ ] Doc updates committed with the code and **pushed to `main`** (unsaved = undone)
