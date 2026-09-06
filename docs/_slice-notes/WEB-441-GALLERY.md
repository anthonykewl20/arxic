# WEB-441-GALLERY — staged integration updates

Refs #441 and #402. Current-head CI and proof are recorded in the PR before merge.

## 1. `docs/SYNC.md` — tracker row

```
| #441 | [WEB-441-GALLERY] Filter and paginate visual run captures | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row

```
| 2026-09-07 | #441: searchable browser/theme/viewport/comparison capture gallery; six-capture pages, explicit counts and original evidence actions. Real dashboard/reference matrix proof and current-head CI recorded in PR. #402 remains open. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### Added`

```
- WEB-441-GALLERY (refs #441): find captures within a run using combined filters, matching counts and keyboard-accessible pagination while preserving evidence and baseline history.
```

## 4. `VERSION` bump required?

Yes, user-observable dashboard navigation. Integrator applies the next synchronized
VERSION/package increment with the deferred notes. This worktree leaves globals
unchanged at 0.0.200.

## 5. Evidence pointers

Real Chromium dashboard journeys use actual Chromium/Firefox/WebKit captures from
the reference application. Retained proof and final gates are recorded before merge.
No human release inspection, paid-model quality or full heuristic certification.

## 6. Sad paths proved

Missing filters reproduced in a real browser before implementation. No-match
feedback, combined filters, page clamping and legacy environment defaults are
covered. Read-only selection preserves original capture objects; UI proof exercises
run changes, polling and baseline history. Large-array paging is supplementary.
Screenshot review also reproduced the global click handler re-enabling a React-owned last-page button. Request-owned disabled-state restoration fixes it; the exact last-page assertion remains. The test waits for the rendered capture after API completion instead of racing the 2.5-second dashboard poll. No numeric assertion was weakened. Filters do not persist across reload/bookmark navigation;
workflow checkpoint galleries and broader oracle/state coverage remain separate.

Mobile keyboard navigation also reproduced a heading hidden beneath the 65px sticky
header. Token-based scroll clearance preserves visibility; the exact measured
heading-versus-header inequality remains. A first 64px clearance was insufficient
and was corrected without relaxing that assertion.

A real reference-app 404 additionally proves filtering does not hide the six blocked
environment outcomes. Clearing a no-match filter restores six preserved captures;
blocked runs expose no baseline-approval action. This uses real engines and the
reference server's missing-page response, not a simulated launch failure.
