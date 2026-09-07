# WEB-454 — native density and dashboard proof (in progress)

This is **partial development evidence, not production-readiness or merge proof**.
Source base is `3d67cf2c7c47435153949fa7138ae5c1de11d2ce` with dirty slice changes;
original provenance files retain that fact. No human inspection is claimed.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Density selection, keyboard controls, 320/390/768/1440px layout, filter and saved settings | Local pass | `dashboard/` named PNGs, numeric/Axe audits and sanitized timelines |
| Oversized capture error behind footer | Reproduced, then local pass after focus/scroll clearance | `error-before/`, `error-visibility-red.txt`, `dashboard/*/01b-pixel-limit.png` |
| Native 2× image picking | Local pass at 320/1440px against independently measured live Login button | `dashboard/*/02b-native-element-*.png` and source test |
| AI filename integration | Reproduced, then pass | `review-red.txt`, `review-green.txt`; ten tests/two files, 33.80s |
| AI region scaling | Reproduced incorrect `800 600` viewBox for `1600 1200` pixels, then pass | `review-ui-red.txt`, `review-2x/` |
| Native Chromium repeat | **Fail, unresolved**: 167 changed pixels at 3× with equal scene geometry | `native-repeat/` retained masked baseline/repeat pair and `font-check-probe.txt` |
| Full installed distribution/current-head CI | Not run for this slice | No PR or merge claim |

Final Chromium density UI passed two tests in 32.38 seconds, including the unchanged
error-containment assertion. Chromium AI review passed both 1× and 2× journeys in
the preceding mixed run; that run still failed the first error-scroll implementation
by 0.46875px. The assertion was not widened. WebKit subsequently passed all four
updated dashboard/review journeys in 86.35 seconds. Firefox's final density UI plus selection/admission/budget/compatibility follow-up passed 27 tests in six files in 42.30 seconds (`area-final.txt`). These are source-driven dashboards, not newly installed packages.

AI responses use an explicit local HTTP provider boundary. The test exercises real
screenshots, authorization, image limits, pending submission and hypothesis review;
it does not establish model judgement quality or new paid-model inference. No LLM
assigns `verified`.

## Visual inspection and artifact boundaries

The agent inspected the original mobile density controls, filter and native-element
proof, then inspected the final light/dark error screenshots. The final error text
is fully above the footer. The retained 2× desktop/mobile AI region screenshots
were inspected; the coordinate scale is corrected. Their prose has a missing space
before `2×`, corrected afterward and exercised in the subsequent WebKit run.

The complete final Chromium dashboard and 2× review sequences are retained with
original sanitized timelines and privacy provenance. The remaining images in those
sequences are machine evidence, not a claim of independent human inspection.
`native-repeat/` retains only the failing Chromium 3× screenshot/assessment pair;
its original timelines cover all nine environments, whose other image files are
not duplicated in this focused subset. `error-before/` is likewise a named subset.

The manifest binds retained bytes. PNG hashes and timeline provenance are checked
independently. Logs contain selected original summary/expected-value lines only;
no raw traces, request bodies, DOM dumps, credentials or process exception bodies
are attached. Reference-app fields are masked at capture time.

## What remains

Native Chromium text paint varies across fresh captures. Changing the font-check
size, disabling hinting/GPU, waiting for animation frames and pre-capturing did not
establish a fix. Those experiments are not production changes. The scene-read
probes are evidence of correlation, not a proven causal explanation. The baseline
repeat assertion remains exact and failing; no threshold, fixture CSS or assertion
was loosened to hide it.

The installed runner includes the new density UI journey but has not run on this
branch. Final-head CI, remaining native acceptance, full heuristic/state/locale/role
coverage and human release inspection are still owed. The #454 issue stays open.
