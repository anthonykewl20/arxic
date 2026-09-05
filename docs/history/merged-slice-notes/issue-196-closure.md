# issue-196-closure — staged doc updates (charter §10.2)

Issue: #196 · PR: #TBD · Disposition: mixed — gate institutionalized; AC-3 sign-off not discharged (an LLM may never assign `verified`, ADR §2)

## 1. `docs/SYNC.md` — tracker rows/status, issue-state corrections, session-log

```
- Five #196 span flips: status line, next-action parenthetical, issues row, milestone paragraph, tracker row #196.
- Stale issue-state corrections in the same lines: #242/#259 closed 2026-08-24 (COMPLETED); #288 closed 2026-08-24 (COMPLETED) — ALL-Domain 13 done / 2 open: #256, #244; DG-12 staging-fact corrections (staging merged as PR #294; `issue/256` campaign branch now pinned `ad12edb`, unmerged — Next-action paragraph + `#256` tracker row, whose overall status stays with the DG-12 slice).
- Heading updated from 18/20 to 20/20 issues closed.
- Last-session refresh to 2026-08-31.
- Session-log row appended (2026-08-31).
```

## 2. `docs/SYNC.md` — session-log entry

```
| 2026-08-31 | Closed #196 with the gate institutionalized — AC-1 procedure doc first landed via PR #229 with its manifest-first revision + AC-2 census tooling merged via PR #237 and AC-4 standing-gate registration merged via PR #332, owner approved closure on 2026-08-31, and AC-3 first human census sign-off never discharged and still owed at the first promoted release with retained screenshots (`v0.1.1` pending `NPM_TOKEN` + tag; only tag `v0.2.0` predates the gate; `gh secret list` empty). Docs changed: `docs/SYNC.md` (tracker rows/status, issue-state corrections, Last-session refresh, session-log append), `CHANGELOG.md` `[Unreleased]` `changed`-section entry, this note, superseded-by pointer on `issue-196-charter-gate.md`. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### changed`

```
- Screenshot-inspection release gate institutionalized; tracker #196 closed (2026-08-31): the human visual census inspection of retained promoted screenshots stands as a permanent release gate — `docs/release-gates/screenshot-inspection.md` (procedure + sign-off format), `scripts/inspection-manifest.mjs` (census tooling, PR #237), `RELEASES.md` checklist step 9, and `docs/engineering-charter.md` §11 — so enforcement lives in the release checklist, not in an open issue. The first sign-off was never discharged: no promoted release with retained screenshots exists since the gate landed (`v0.1.1` pending `NPM_TOKEN` + tag), and it remains owed at the first such release; `docs/SYNC.md` tracker rows/status flipped to match, plus stale issue-state corrections verified against GitHub 2026-08-31 (#242/#259/#288 closed 2026-08-24 COMPLETED — ALL-Domain 13 done, 2 open). No pixel content is certified by this change.
```

## 4. `VERSION` bump required?

no — docs-only, not user-observable.

## 5. Evidence pointers

- Real-world proof: N/A — docs-only closure; no inspection or sign-off was performed.
- Artifacts: N/A — no screenshot census artifact exists.
- Gates: typecheck ☐ (n/a, no code) · lint ☐ (n/a, no code) · format ☑ (full-repo `pnpm format:check` re-run on the finished change before merge; CI step 10 is the arbiter) · test ☐ (n/a, no code) · license gate ☐ (n/a, no code).

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                         | Expected disposition | Test |
| ----------------------------------------------- | -------------------- | ---- |
| N/A — docs-only closure, no executable behavior | n/a                  | n/a  |
