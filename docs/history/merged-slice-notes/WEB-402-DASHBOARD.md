# WEB-402-DASHBOARD — staged doc updates

Issue: #402 · PR: [#421](https://github.com/anthonykewl20/arxic/pull/421) · Disposition: observed; wider production requirements remain open.

## 1. SYNC tracker row

```text
| #402 | Full web tester — dashboard UX, searchable history, accessible themes and numeric evidence | In progress; dashboard audit landed, full product/release gates remain |
```

## 2. SYNC session-log row

```text
| 2026-09-06 | **WEB-402-DASHBOARD:** integrated the existing local dashboard rewrite and corrected observed navigation, retrieval, keyboard, responsive, contrast, clone-boundary and recording-privacy defects. Real Chromium dashboard journeys and reference-app capture proof are recorded in docs/evidence/WEB-402-DASHBOARD-UX/summary.md. #402 remains open; no release or human screenshot sign-off is claimed. |
```

## 3. CHANGELOG entry

```text
- WEB-402-DASHBOARD (refs #402): searchable paginated run history with bookmarkable filters; accessible responsive themes and modal keyboard behavior; numeric measurement evidence and retry; corrected capture backdrop/control sizes and contrast. Refuse unmasked video and escaped/existing clone targets. Real-browser dashboard and reference-app proof accompanies the change.
```

## 4. VERSION bump

Yes, user-observable capability and fixes. Integrator must fold this note and WEB-402-ORACLE together in merge order and apply the owner-defined version rule. This worktree does not edit VERSION, CHANGELOG or SYNC.

## 5. Evidence and gates

[Dashboard audit](../evidence/WEB-402-DASHBOARD-UX/summary.md). The full web suite passed 62 tests / 18 files at d08c84a; image-review refinements passed four focused browser tests at 30bf534. Lint, root/package typechecks and the license gate pass. Final pagination-semantics proof passed three browser tests at 1c48fc6. The 89 retained audit checkpoints have zero violations, incomplete entries or overflow. Full-repo format output: `All matched files use Prettier code style!`. Final-head CI and merge disposition are recorded in PR #421. Its CI correction record covers the reproduced polling/injection race and shared-hash structural fix; no assertion tolerance or structural exemption was loosened.

## 6. Sad paths

| Trigger                               | Expected result                                  | Test                                       |
| ------------------------------------- | ------------------------------------------------ | ------------------------------------------ |
| Missing run bookmark                  | History with explanation, valid session retained | dashboard-ux.real-world.test.ts            |
| Missing measurement response          | Visible error and retry; no pass                 | ui.real-world.test.ts                      |
| No matching search / stale offset     | Empty guidance / return to valid page            | ui.real-world.test.ts, run-history.test.ts |
| Missing auth secrets                  | Block before capture                             | visual-auth.real-world.test.ts             |
| Unmasked recording request            | Refused configuration / blocked legacy capture   | workspace.test.ts, visual.ts               |
| Escaped/existing clone folder         | Refused before cloning/updating                  | workspace.test.ts                          |
| Late anonymous or pre-logout response | Session remains invalidated                      | ui.real-world.test.ts                      |
