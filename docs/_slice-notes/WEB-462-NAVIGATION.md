# WEB-462-NAVIGATION — staged doc updates

Issue: #462 · PR: #463 (draft, based on #461) · Disposition: mixed, validation in progress

## 1. `docs/SYNC.md` — tracker row

| #462 | Direct navigation to filtered source declarations | In progress |

## 2. `docs/SYNC.md` — session-log row

2026-09-07: Real #460 evidence showed matching declarations below a long route inventory. Add per-project matching-result links beside the filters; keyboard/pointer activation focuses and scrolls to the heading in the same view. Shared selection mechanics produce link counts and table rows. The 320-pixel browser test also exposed source hash overflow, corrected through wrapping. Built on PR #461 head `70270595`, which must merge first. Full #402 remains open.

## 3. `CHANGELOG.md` — entry under Unreleased

- Make filtered declarations directly reachable by keyboard and pointer, including explicit zero-result navigation. Keep the heading and focus outline below the mobile header; wrap revision hashes at 320 pixels. Extend the required installed reference-source/dashboard journey without removing any test file.

## 4. `VERSION` bump required?

Yes, user-visible navigation improvement; integrator owns the shared version/doc fold. No VERSION or package version changes in this worktree.

## 5. Evidence pointers

- `apps/web/src/__tests__/frontend-template.real-world.test.ts`: actual committed Express reference source, running page and source/installed dashboard, with unchanged thirteen-control assertion.
- Red: missing result navigation; first fragment-link implementation left the heading off-screen; 320-pixel hash overflow was 3 pixels; Firefox focus top was 63.5 against a 64-pixel minimum. Thresholds remain unchanged, viewport tightened from 390 to 320.
- Local Chromium initially passed after hash wrapping (12.51 s). Final Firefox clearance passed (15.93 s); WebKit passed (14.15 s). Final Chromium/workbench regression passed: 3 cases / 2 files / 113.48 s. Installed acceptance remains pending. Final TypeScript/lint passed; full-repo format after this note: `All matched files use Prettier code style!`.
- No raw traces; named capture-masked screenshots and sanitized timeline/provenance are retained with red/green results in `docs/evidence/WEB-462-NAVIGATION/summary.md` and its hash manifest.

## 6. Sad paths proved

| Trigger                                       | Expected disposition                             | Test                                              |
| --------------------------------------------- | ------------------------------------------------ | ------------------------------------------------- |
| Search yields no declarations                 | Reachable explicit empty result                  | Real dashboard search/navigation                  |
| Long route table precedes matching controls   | Focused heading visible without manual scrolling | Keyboard Tab/Enter and pointer activation         |
| Revision hash exceeds 320-pixel content width | Wrap with zero page overflow                     | Real mobile screenshot/geometry audit             |
| Heading lands under mobile header             | Visible clearance and focus preserved            | Firefox red then passing clearance; WebKit passes |

Remaining: final browser and current-head installed CI, predecessor merge, integrator fold, historical duplicate-ID inventory rendering, wider themes/states and independent human release inspection. No completion claim.

Integration: PR #463 is based on `feat/frontend-templates` for review only. After #461 merges, integrate main into the published navigation branch (no force push), retarget #463 to main, and require fresh exact-head CI before merge. Never merge this PR into its feature-branch base.
