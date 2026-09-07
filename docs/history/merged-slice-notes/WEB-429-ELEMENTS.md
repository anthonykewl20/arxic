# WEB-429-ELEMENTS — staged doc updates (charter §10.2)

Issue: #429 · PR: linked from issue #429 · Disposition: local validation passed; completion requires current-head CI-gated merge.

## 1. `docs/SYNC.md` — tracker row

```
| #429 | [WEB-429-ELEMENTS] Screenshot-bound element inspection | Complete only after required CI-gated merge |
```

## 2. `docs/SYNC.md` — session-log row

```
| 2026-09-07 | **#429 (WEB-429-ELEMENTS)** Dashboard screenshot picking, keyboard measurement-ID search, pagination, parent navigation and existing check references. Original visual PNG/assessment and workflow evidence share bounded/hash-checked byte reads. Malformed or unbound geometry and failed images remain unavailable. Desktop topbar obstruction corrected without weakening axe checks. Real Chromium/reference-app proof and required PR CI determine completion. Next: remaining #402 product/release gates. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- WEB-429-ELEMENTS (refs #429): inspect captured numeric element boxes by screenshot point or keyboard ID search, navigate retained parents, and review overlapping measurement checks. Reject malformed/unbound geometry and changed or symlinked original image evidence; recover from unavailable images/reports. Keep solver verdicts and incomplete coverage explicit.
```

## 4. `VERSION` bump required?

Yes, user-observable addition; integrator applies the owner's version policy in
merge order. No worktree SYNC/CHANGELOG/VERSION edits.

## 5. Evidence pointers

- `apps/web/src/__tests__/ui.real-world.test.ts` and `element-inspector-proof.ts`:
  actual Chromium dashboard and vulnerable-auth-app, independent DOM measurement
  versus screenshot outline, keyboard navigation, mobile scaling and recovery.
- `apps/web/src/__tests__/visual.test.ts`: actual reference-app capture/baseline
  pipeline, changed bytes and byte-identical symlink refusal.
- `apps/web/src/__tests__/element-scene.test.ts`: supplementary malformed/unstable,
  missing-parent, boundary and deterministic ordering cases.
- Full web/structural suite: 95 tests / 24 files passed in 445.88 s at implementation `53b79f1`. Typecheck/lint/license pass. Final inspector refinement passed both full light/dark UI journeys in 85.73 s at `cfcae2b`; required CI remains pending.
- [Retained proof](../evidence/WEB-429-ELEMENTS/summary.md): 56 agent-viewed PNGs and six independently hash-checked sanitized timelines, including the first and final inspector layouts.
- No raw traces or human screenshot sign-off. No full browser/state/role matrix claim.

## 6. Sad paths proved

| Trigger                                             | Expected disposition                            | Test                                   |
| --------------------------------------------------- | ----------------------------------------------- | -------------------------------------- |
| Changed original PNG bytes                          | HTTP 409; prior baseline retained               | Actual visual run artifact API         |
| Byte-identical image symlink                        | Refused                                         | Actual visual run artifact API         |
| Duplicate nodes or mismatched image binding         | Geometry unavailable; retry offered             | Real Chromium report response boundary |
| Unstable/nonfinite/oversized/offscreen/cyclic scene | Unavailable, no invented measurement            | Scene projection seam                  |
| Image response unavailable                          | Picking disabled; retry restores measured image | Real Chromium                          |
| Unknown element number                              | Explicit empty result, no automatic fallback    | Real Chromium                          |
| Partial scan or absent parent                       | Incomplete scope retained                       | Scene projection seam                  |

Red-first: original-image endpoint returned 200 after tampering (expected 409);
missing inspector and malformed-report retry timed out before implementation.
Expanded axe audit reproduced a partially obscured action under the desktop sticky
topbar. The header now scrolls with the page; the same assertion passes. Exact
geometry assertions were not widened. Screenshot review additionally identified
check-detail density and viewport framing improvements; final proof will record
those separately from the first implementation.

Final disclosure/feedback proof retains 10 new inspected PNGs at `cfcae2b`; Enter
expands/collapses measurement details, parent selection starts with details closed,
and screenshot-point/keyboard/mobile checks pass. Total proof: 56 PNGs, six timelines.
No matcher was widened. Typecheck/lint/license pass. Full-repository format check
after this note must print `All matched files use Prettier code style!`. Required
current-head PR CI remains the completion gate.
