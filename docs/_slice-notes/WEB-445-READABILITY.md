# WEB-445-READABILITY — staged doc updates (charter §10.2)

Issue: #445 · PR: #446 · Disposition: observed source proof; current-head CI required

## 1. `docs/SYNC.md` — tracker row

- [ ] WEB-445: text-spacing/enlargement journeys, adaptive navigation, text-button and header reflow, keyboard model catalog. Flip only after PR #446 required `ci` prints `pass` on its final head.

## 2. `docs/SYNC.md` — session-log row

WEB-445: added five real readability cases to the shared installed contract
(23 tests / 13 files). Clean source Chromium, Firefox and WebKit each passed six
readability/navigation cases at `9bc52fd`. Screenshot review caught mobile word
splitting after containment checks had passed; the added whole-word assertion
failed red before the adaptive grid fix. Current-head installed acceptance is
recorded on PR #446. Incomplete accessibility and human release gates remain open
under #402.

## 3. `CHANGELOG.md` — proposed `Fixed` entry

- Dashboard readability (#445): navigation and text buttons grow with text; mobile navigation adapts its column count; run headings, breadcrumbs and activity rows and folder metadata wrap across system fonts; the model catalog supports keyboard scrolling. Real-app spacing/enlargement tests retain numeric checks and masked evidence, including a deliberately clipped control guard.

## 4. `VERSION` bump required?

Yes, user-observable fixes. The integrator applies the synchronized patch increment
with the deferred notes. Global version, SYNC and changelog files remain unchanged
in this worktree.

## 5. Evidence pointers

[Retained evidence](../evidence/WEB-445-READABILITY/summary.md) includes 27
agent-viewed masked PNGs and exact sanitized timeline excerpts with original and
selected hashes. All 378 original PNGs and 18 timeline hashes matched. Each
engine passed all six source cases, with no unexpected numeric failures,
automated accessibility violations or document overflow. Incomplete analysis
remains unverified. The deliberately clipped control produces a failed finding.
Initial installed CI exposed font-dependent Administration and folder metadata
clipping after the original source passes. Both were reproduced locally using
a canaried font override. Production headings, section rows and picker metadata
now wrap; the wizard waits for populated rows and captures scrolled metadata.
Clean Chromium at `429123b` passed six cases in 119.50s (130 PNGs / six timelines).
The font override was removed; CI failures and diagnostic provenance are retained.
Current-head installed CI remains required before completion; source proof does
not discharge it. The PR records the final full-repository format result after
this note and the evidence summary were written.

## 6. Sad paths proved

| Trigger                                | Expected disposition                           | Test                               |
| -------------------------------------- | ---------------------------------------------- | ---------------------------------- |
| Deliberately clipped real login button | Contradicted numeric containment; failed audit | Clipped-control guard              |
| Unknown text profile                   | Explicit rejection                             | Clipped-control guard              |
| Incomplete accessibility analysis      | Unverified audit, never silent pass            | Shared dashboard proof helper      |
| Picker title truncates                 | Full exact heading required after activation   | All four readability journeys      |
| Model catalog overflows vertically     | Keyboard focus and End/Home recovery required  | Enlarged-text journeys             |
| Contained navigation splits a word     | Failed whole-word finding                      | Desktop and open mobile navigation |

No numeric epsilon or accessibility threshold was widened. Provider picker titles
have a recovery exception backed by exact full-heading activation checks; this
corrects an ellipsis false positive explicitly. DOM Range metrics are not optical
or glyph correctness. Native zoom, arbitrary input-text clipping, full
persona/locale/state coverage, transient causality, paid-model quality and human
release inspection remain gaps. No LLM assigns `verified`.
