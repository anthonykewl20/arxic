# WEB-441 — capture gallery evidence

Refs #441 and #402. Final proof uses clean commit
`5341fea3932e37701e30e482fd4b90925bcf3b82`. Required current-head CI is recorded
in the PR/issue before merge. This is scoped automated and agent-reviewed evidence,
not a human release sign-off.

## Execution

Final gallery/selection proof: **4 tests / 2 files in 108.16 s**, both dashboard themes.
The earlier changed-area/existing-flow suite passed **10 tests / 6 files in
169.61 s**, covering matrix configuration, baseline history, element inspection
and visual review before the final mobile-clearance/test follow-ups. Current-head
CI covers those final changes and the installed dashboard journey.

Each theme exercises a real reference response through Chromium, Firefox and
WebKit, at 800×600 and 390×844. A controlled CSS change supplies the dark-only
regression trigger. An actual reference-server 404 supplies the blocked run.
Browser UI proof uses widths 320, 390, 768 and 1440. Test API setup supplies the
required Origin header; authorization checks were not bypassed or changed.

## Pass/fail by test point

| Check | Result and evidence |
| --- | --- |
| No matching path | Pass: zero cards, explicit count/reset, full environment list retained. [No matches](screens/light/01-no-matches.png). |
| Combined filters | Pass: path, browser, theme, viewport and historical comparison select the original WebKit/dark/390 capture. [Mobile controls](screens/dark/03-filtered-320.png). |
| Bounded pagination | Pass: six original captures per page; changing filters clamps to a valid page. Last-page Next remains disabled. [Keyboard page](screens/light/02-next-page.png). |
| Mobile keyboard focus | Pass: heading starts at 79.859375px, below the sticky header's 65px bottom, in both themes. [Mobile focus](screens/light/02-mobile-page.png), [measurements](screens/light/measurements.json). |
| Evidence actions | Pass: downloaded PNG SHA-256 matches the selected capture; measurement/element inspection opens; the review form retains its exact capture ID/hash. No model judgment is claimed. |
| Approval/history | Pass: UI approval targets the selected capture, and the original run result remains unchanged. [Approved](screens/light/04-approved.png). |
| Polling/run changes | Pass: typed filters survive dashboard polling; changing runs resets them. A repeated run has 12 unchanged comparisons with zero changed pixels. [Repeat](screens/dark/05-repeat.png). |
| Real regression | Pass: six dark captures change and six light captures remain unchanged; the Firefox/800 changed result retains its original baseline reference. [Comparison](screens/dark/06-regression.png). |
| Real blocked environments | Pass: reference-app missing page blocks all six environments while six successful captures remain. No-match filtering retains the blocked outcomes; clearing restores the captures without approval actions. [Blocked](screens/light/07-blocked.png). |
| Legacy/large-array supplement | Pass: absent environment metadata uses legacy Chromium/light defaults; combined filters, reference identity and page clamping are tested on 31 captures. This is not a large live-run performance benchmark or old-build migration. |

## Review and corrections

The retained set contains **22 named masked PNGs, two sanitized timelines and 22
axe/reflow reports**, plus numeric measurements for each theme. Image/timeline
SHA-256 values and clean-source markers were checked independently. All screenshots
were agent-viewed; mobile focus and selected regression were also inspected at
original size. Audit reports contain zero reported violations, incomplete checks and horizontal overflow. No raw traces are retained.

Red-first proof reproduced the missing search control (11.07 s), ambiguous select
names, and a global click handler re-enabling the last-page button (15.16 s). The
handler now restores only the request buttons it disabled. Mobile focus originally
landed at -0.140625px under the header; an initial 64px offset was still insufficient
(63.859375px measured) and correctly failed. The exact geometry assertion remains.
A test polling race was fixed by waiting for a rendered capture after API completion;
it still requires exactly six cards. No numeric matcher was relaxed. Evidence was
reframed around matching counts so the selected comparison is visible.

Filters are local view state, not persisted bookmarks; workflow checkpoint galleries
remain separate. These checks do not prove full heuristic/accessibility coverage,
all workflow states, all locales/devices, paid-model quality or human usability.
The broader product and human release inspection remain open under #402.
