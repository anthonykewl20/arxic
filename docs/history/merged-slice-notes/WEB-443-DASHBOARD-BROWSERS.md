# WEB-443-DASHBOARD-BROWSERS — staged doc updates

Issue: #443 · PR: #444 · Disposition: observed local proof; current-head CI required

## 1. `docs/SYNC.md` — tracker row

- [ ] WEB-443: shared Chromium/Firefox/WebKit installed dashboard gate and source-picker, measurement-reveal/retry and forced-color fixes. Flip only after PR #444 required `ci` prints `pass` on its final head.

## 2. `docs/SYNC.md` — session-log row

WEB-443: added explicit dashboard engines with actual browser provenance, expanded clean-room installed dashboard proof to 18 tests/12 files, corrected stable source-picker placement, measurement reveal/retry and system-color contrast. Clean local Firefox six-case and WebKit navigation proof passed at `442b447`; current-head CI acceptance is recorded on PR #444. Incomplete accessibility checks remain unverified; human and full temporal/matrix coverage remain open under #402.

## 3. `CHANGELOG.md` — proposed entry

- Fixed: source folder loading no longer moves Continue; selecting an already-selected measurement reveals its full preview; image retry requests fresh bytes; forced-color buttons use readable system colors.
- Added: explicit dashboard browser selection, shared installed dashboard CI across Chromium/Firefox/WebKit, browser provenance, persistent-overflow negative guard and incomplete accessibility verdicts. Refs #443.

## 4. `VERSION` bump required?

Yes, user-observable fixes. The integrator applies the synchronized patch increment with deferred notes. Worktree global version, SYNC and changelog files remain unchanged.

## 5. Evidence pointers

[Retained proof](../evidence/WEB-443-BROWSERS/summary.md): twenty agent-viewed named PNGs, nine sanitized timeline excerpts with original hashes, adjacent audit/privacy records and numeric geometry. Clean Firefox six cases passed in 263.70s; WebKit navigation passed in 43.45s. All 157 original PNG and eleven original timeline hashes matched. Five Firefox audit reports retain incomplete contrast; the only overflow is the intentional 704px detector guard. Driver/runner/gate contracts: 24 passed. Final-head installed CI is required before completion; historical `6a412c7` package success does not discharge it.

## 6. Sad paths

| Trigger                              | Expected disposition                        | Proof                            |
| ------------------------------------ | ------------------------------------------- | -------------------------------- |
| Unsupported dashboard engine         | Reject without fallback                     | Driver contracts                 |
| Dashboard-only runner                | Never emit full CLI success                 | Runner contracts                 |
| Failed/skipped/cancelled browser job | Required gate fails                         | Gate contracts                   |
| Different target/dashboard engines   | Exact expected rectangles use target engine | Real element inspector           |
| Delayed real folder response         | Continue does not move                      | Exact source-layout measurements |
| Failed image followed by retry       | Fresh URL and full visible preview          | Main light/dark journeys         |
| Forced-color palette                 | Readable controls, unchanged Axe threshold  | WebKit before/after              |
| Persistent page overflow             | Failed even after static settling           | Real stylesheet negative guard   |
| Incomplete accessibility analysis    | Unverified, not silent pass                 | Audit timelines                  |

No assertion epsilon or accessibility threshold was widened. A transient 42px gallery overflow's cause remains unestablished; fixed readiness and repeated pagination are not a claim that every transient frame is correct. Provider controls do not prove paid model quality. Human inspection, real-device Safari, full i18n/zoom/persona coverage and production release sign-off remain outside this slice.
