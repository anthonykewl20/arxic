# WEB-443-DASHBOARD-BROWSERS — staged doc updates

Issue: #443 · PR: pending · Disposition: mixed; work in progress

## 1. `docs/SYNC.md` — tracker row

Keep #443 in progress until current-head CI passes.

## 2. `docs/SYNC.md` — session-log row

Draft: extended the dashboard driver to Chromium, Firefox and WebKit, separated
capture-engine geometry from dashboard-engine rendering, and added a shared
installed dashboard runner. Real Firefox validation has failures under diagnosis.

## 3. `CHANGELOG.md` — proposed entry

- WEB-443-DASHBOARD-BROWSERS (#443): explicit dashboard engines, actual browser
  provenance and expanded installed dashboard E2E gates. Validation pending.

## 4. `VERSION` bump required?

Yes: measurement-image retries now request a fresh URL. The integrator applies
the synchronized increment with deferred notes; worktree globals stay unchanged.

## 5. Evidence pointers

- Driver and runner contract checks: 24 passed across driver, runner and CI-gate tests; red failures recorded.
- Web package typecheck and changed-area lint passed. Firefox element-kind proof
  passed after correcting protocol/DOM precision mismatch; installed proof pending.
- No retained visual evidence or current-head CI pass yet.

## 6. Sad paths

| Trigger                               | Expected result                    | Proof                           |
| ------------------------------------- | ---------------------------------- | ------------------------------- |
| Unknown dashboard engine              | Reject, no fallback                | Driver tests                    |
| Dashboard-only validation             | Never claim full CLI flow          | Runner verdict tests            |
| Capture engine differs from dashboard | Exact geometry uses capture engine | Real-browser validation pending |

No product truth state or human release sign-off is assigned by this note.

Initial full Firefox run: 13 passed / 4 failed (17 tests, 430.23s). Independent
target geometry now uses the recorded capture engine. Element-kind lookup uses
exact DOM rectangles rather than automation protocol bounds (a 0.000015px
precision mismatch); no epsilon was introduced. Resize checks wait for applied
viewport dimensions and two animation frames. Timing-sensitive overflow did not
reproduce with screenshot pacing; final proof must still require zero overflow.
Measurement-image failure recovery uses attempt-specific URLs to avoid reusing
an already-loaded image. The original error and successful retry remain asserted.

WebKit full source run: 16 passed / 1 failed (17 tests, 430.49s). The only failure
was two forced-colors buttons at 1.81:1, white on #c0c0c0. Canvas/CanvasText fixes
the system-color pairing without hiding controls or changing the Axe threshold.
Focused WebKit navigation then passed in 40.87s. The pixel oracle now requires
both dark and light paint (the original dark-pixel minimum is retained), covering
both system palettes. Chromium navigation passed in 30.11s and Firefox in 47.51s; current-head CI pending.

The initial WebKit proof has 200 hash-checked PNGs and 20 hash-checked timelines;
178 audits include one failing forced-color report and eight reports with explicit
incomplete contrast checks. Eight campaign PNGs lacked browser identity in their
legacy metadata; the writer is corrected for subsequent proof. No missing
metadata is retroactively fabricated. CI setup failure was reproduced and fixed
with the package-scoped Playwright command (6a412c7).

Installed CI 34063249952 on 6a412c7 passed all four shards, static, fixture apps,
worker image and full Chromium package validation (HUMAN-FLOW-E2E PASS,
604.823s total; 481.594s browser phase). Both added dashboard jobs failed, so the
required gate correctly stayed red. WebKit reproduced forced-color contrast and
an offscreen measurement crop; Firefox exposed navigation before login finished
and a missed source-step transition. These are not waived or flaky reruns.

A delayed real folder response reproduced a 55px Continue-button movement in
Firefox (753.7999877929688 to 808.7999877929688). The picker now reserves a bounded
responsive height, with exact position equality asserted. Gallery navigation waits
for authenticated overview. Re-selecting the same measurement now reveals the
HTML image container: WebKit's SVG scroll behavior otherwise centers painted
content rather than the complete capture. The full preview must be inside the
viewport before the unchanged pixel-ink check; no crop clamping is used.

The fixed folder/measurement journey passed Firefox light in 63.16s (one focused
case; dark excluded by the test-name filter). Named source-loading/source-ready
proof points are included in the final evidence run. Web typecheck passes.
