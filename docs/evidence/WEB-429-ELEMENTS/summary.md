# WEB-429-ELEMENTS — dashboard element inspection proof

Refs #429 and ongoing #402. No release authorization or human inspection is claimed.

The first implementation is `53b79f1a5287a66c4ca3dab72efce8a7732caab0`.
`dashboard/` contains 36 named screenshots from populated light/dark dashboard
journeys. `before/` contains 10 initial element-inspector screenshots. All 46 were
agent-viewed; image hashes and all four sanitized timelines were checked. No raw
trace ZIPs were retained. Numeric audits report no violations or horizontal overflow;
axe's incomplete checks remain in adjacent audit records.

The browser drives the actual dashboard with real vulnerable-auth-app source and
Chromium capture/baseline execution. It independently measures the reference page's
heading and parent in a separate browser page, then checks every outline coordinate
against those measured values on desktop and mobile. Synthetic scene cases only
supplement this real-app proof. Model endpoints in the wider engine suite use the
existing controlled external boundary; no new paid/provider inference is claimed.

## Journeys

| Journey | Expected result | Proof |
| --- | --- | --- |
| Connect project, discover intents and source declarations | Real source rows and explicit gaps | dashboard/01–03 and 09–10 in both themes |
| Run visual test, approve baseline and rerun | Unchanged baseline without changing business truth | dashboard/04 |
| Malformed duplicate IDs / screenshot binding mismatch | Inspector unavailable, retry restores valid report | dashboard/14-invalid and 15-unbound |
| Image failure | Picking disabled; retry loads approved image | before/01 and final inspector proof |
| Missing element number | Explicit empty result, no fabricated match | before/02 and final inspector proof |
| Keyboard selection and pagination | Selected numeric node and bounded result pages | Sanitized inspector timelines and browser assertions |
| Screenshot heading / retained parent | Exact independent CSS geometry | Inspector 03–04 |
| Mobile picking | Same original CSS geometry at 390×844 | Inspector 05 |
| Schedules, settings, administration and session recovery | Save/navigation/error-retry behavior | dashboard/05–08, 11–13 |

Screenshot review found excessive check-reference density in parent selection and
weak evidence framing for empty results. The final inspector refinement exposes
check details through a keyboard-operable disclosure and explicitly frames the
feedback/outline. Before images preserve the observed problem. No exact geometry,
accessibility or integrity assertion was weakened.

Remaining scope: full browser/OS/locale/role/state matrix, semantic runtime locator
inventory, paint-order/hit testing, every heuristic family and human release review.
Numeric element IDs are measurement references, not source names or replay selectors.
Difference images and legacy visual privacy sidecars do not gain separate hashes
in this slice.

## Final local validation

- Full web and canonical structural suite at `53b79f1`: **95 tests / 24 files passed**, 445.88 s. This includes actual Next.js/Express, source/compiler/verifier, Mailpit, workflow galleries, dashboard/navigation/campaign/provider/session tests and the original-image integrity checks.
- Final disclosure/feedback implementation `cfcae2b`: both complete light/dark UI journeys passed, **85.73 s**. The added disclosure assertion first timed out against the earlier implementation; Enter now expands and collapses check details. Exact bounds, parent, pagination, mobile and failure-recovery assertions remain intact.
- `elements/` adds **10 agent-viewed final PNGs** and **two hash-checked sanitized timelines**. Total retained: **56 PNGs and six timelines**. The final metadata's dirty flag reflects untracked proof/slice documentation and progress-review documentation; production and test bytes are committed at `cfcae2b`.
- Typecheck and lint pass after the refinement. License gate passes: 808 packages, 806 allowed, two existing exceptions, zero rejected.
- Required current-head CI is pending; the PR linked from issue #429 is the authoritative completion record.

Representative final evidence: [picked heading](elements/light/03-picked-heading.png),
[parent outline](elements/dark/04-parent.png), [mobile inspector](elements/light/05-mobile.png),
[empty result](elements/dark/02-no-matches.png), and [invalid geometry](dashboard/light/14-invalid-element-geometry.png).

Final full-repository formatting after authoring the slice note must print
`All matched files use Prettier code style!` before submission.
