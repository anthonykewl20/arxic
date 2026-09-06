# WEB-437 — captured element type filters

Refs #437 and #402. Observed local proof from clean runtime commit
`68a4968c3486a8a4cb40135e49db469fe07836d8`. Required current-head CI is recorded
in the PR and issue before merge. This is scoped evidence, not release approval.

## Execution and evidence

Final real-browser run: **3 tests across 2 files passed in 89.48 s**, including
both light/dark reference-app discovery/capture/inspection journeys and native vs
declared-role collection on the actual dashboard. The changed-area run also passed
34 tests across 4 files. Root/package typechecks, lint and license passed (808
packages, zero rejected). Full-repo format is run after the slice note.

All **23 named screenshots**, **5 sanitized timelines** and **23 axe/reflow
reports** are under [screens](screens). Every screenshot and timeline SHA-256 was
independently checked against adjacent provenance. All screenshots were agent-viewed
in four contact sheets; the 320px light filter and dark point-selection originals
were additionally reviewed at full size. Reports contain **zero violations, zero
incomplete checks and zero horizontal overflow**. No raw trace ZIP is retained.

## Pass/fail per test point

| Test point | Result and evidence |
| --- | --- |
| Find buttons without knowing an element number | Pass: exact count matches independently inspected reference-app buttons; first selection matches independently measured Login bounds. [Light timeline](screens/light/timeline.json), [dark timeline](screens/dark/timeline.json). |
| Combine type with number or screenshot point | Pass: matching subset and selected bounds agree; parent navigation and Show all clear filters. Keyboard operates the native type selector. [Point selection](screens/dark/07-type-and-point.png). |
| Responsive type filters | Pass at 320, 390, 768 and 1440 CSS pixels in both themes; labels, focus and actions remain usable. [320px](screens/light/06-kind-filter-320.png). |
| Missing image, empty match, parent and pagination | Pass: explicit retry/empty states; no trusted image picking without valid image; navigation retains numeric scene identity. |
| Older scene without type metadata | Pass as an explicit response-format boundary supplement: real assessment geometry, screenshot and hash retained, only type metadata removed. Unknown filtering and numeric inspection remain available. [Legacy timeline](screens/light/legacy/timeline.json). This is not a run of an older application build. |
| Native button versus declared radio | Pass: actual dashboard has over 50 captured visible nodes; native Connect project is Button and theme control declared radio is Form field. [Classification timeline](screens/classification/timeline.json). |
| Invalid type metadata | Pass: unsupported epoch and malformed codes rejected from trusted inspection; private extra fields stripped. Hard numeric failures still fail independently of browsing metadata. Unit contract tests. |

## Red-first record and boundaries

The initial real UI test timed out because Element type did not exist. Eight new
parser assertions failed before implementation. The real dashboard role test then
caught a native button incorrectly overriding its declared radio role; precedence
was corrected. No existing assertion was weakened. An explicit browser context
fixed an axe test-harness setup error, and numeric validation order preserves the
existing exact invalid-scene diagnostic.

Types are bounded browsing hints, not computed accessibility roles, replay locators
or solver evidence. Raw DOM names, text, selectors and field values are not retained.
Legacy data remains numeric and explicitly Unknown. The denser dashboard collection
check is not a 2,000-node stress benchmark. The installed-browser CI gate includes
these journeys; this attached proof is from the source runtime. No local packed
437 run or human release inspection is claimed. Broad browser/persona/state coverage,
all UX heuristics, independent usability research and #402 remain open.
