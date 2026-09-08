# Human inspection package — six-head corpus (refs #423)

**For the owner (Anthony).** An LLM may never assign the truth state
`verified`; everything the automation produced is `observed` or `hypothesized`.
Moving any of it to `verified` requires your eyes on this page.

## What to check

Seven case pairs (`<case>-before.png` / `<case>-current.png`), one per new
defect head across five real applications. In every pair the **before** frame
is the unmutated page and the **current** frame is after the single controlled
mutation named in the table. The deterministic oracle's verdicts and the
measured numbers that produced them are listed — verify that what you SEE in
each current frame matches the claimed defect and nothing else broke.

| # | case (family @ viewport) | mutation you should see | oracle verdicts (head=verdict) | your call |
| --- | --- | --- | --- | --- |
| 1 | next-800-occlusion-overlay (repo Next fixture @800) | opaque dark rectangle covering exactly the Login submit button; button itself unmoved | clipping=pass; **occlusion=fail**; missing_element=pass; overflow=pass; text_truncation=pass; layout_shift=pass | ☐ matches ☐ does not match |
| 2 | next-800-text-truncate (repo Next fixture @800) | the page heading forced to one line with ellipsis, visibly cut mid-word | clipping=pass; occlusion=pass; missing_element=pass; overflow=pass; **text_truncation=fail**; layout_shift=pass | ☐ matches ☐ does not match |
| 3 | next-800-layout-shift (repo Next fixture @800) | the Login button translated ~24px from its original position, still fully visible | clipping=pass; occlusion=pass; missing_element=pass; overflow=pass; text_truncation=pass; **layout_shift=fail** | ☐ matches ☐ does not match |
| 4 | express-800-missing-element (repo Express fixture @800) | the Login submit button removed entirely; rest of the form intact | **missing_element=fail**; overflow=pass; text_truncation=pass | ☐ matches ☐ does not match |
| 5 | koel-800-occlusion-overlay (koel docker @800) | opaque rectangle covering exactly the login submit | clipping=pass; **occlusion=fail**; missing_element=pass; overflow=pass; text_truncation=pass; layout_shift=pass | ☐ matches ☐ does not match |
| 6 | todomvc-800-occlusion-overlay (todomvc @800) | opaque rectangle covering exactly the "What needs to be done?" input; the input is privacy-masked in both frames | clipping=pass; **occlusion=fail**; missing_element=pass; overflow=pass; text_truncation=pass; layout_shift=pass | ☐ matches ☐ does not match |
| 7 | adminlte-1280-layout-shift (AdminLTE starter @1280) | the "Go somewhere" button translated ~24px, still fully visible | clipping=pass; occlusion=pass; missing_element=pass; overflow=pass; text_truncation=pass; **layout_shift=fail** | ☐ matches ☐ does not match |

Mechanical facts already machine-checked (no need to eyeball): every pair's
privacy masks are identical between frames, screenshots hash-bound in each
case manifest, and each `fail` verdict came from an independent measurement
(hit-test at the control center, DOM-Range text width, box-center movement,
or control absence) — never from the mutation intent.

## The claim your inspection would upgrade

The corpus-level claim is: these controlled mutations produce the defect they
claim and nothing else, so their labels are correct ground truth. With that
confirmed by a human, the untouched-test-family results recorded in
`../corpus-sixhead/summary.md` (occlusion 4/4 recall, 0 false positives;
overflow calibrated; clipping/text_truncation/layout_shift honestly disabled)
become eligible for `verified` per the repo's truth-state rules.

Mark the table above (edit this file or comment on issue #423); any "does not
match" row becomes a defect against the oracle, not against your judgment.
