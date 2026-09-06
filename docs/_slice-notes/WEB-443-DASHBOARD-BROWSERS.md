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
