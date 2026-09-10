# CORPUS-SCALE-557-S3 — staged doc updates (charter §10.2)

Issue: #557 · PR: _this PR_ · Disposition: observed (slice 3 — an 11th family wired and proven; the ≥1,000-row bar stays open, and the 11-family full-grid re-capture is the next slice)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #557 | [CORPUS-SCALE-557] corpus scale: 11 families toward the 1,000-region bar | ◐ in progress |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-07 | **#557 (CORPUS-SCALE-557-S3) slice 3: 11th corpus family (material-dashboard) wired and proven — with one candidate honestly rejected.** StartBootstrap coming-soon (MIT) was cloned first and rejected without patching: its shipped submit button carries Bootstrap `disabled` (`pointer-events: none`), so the occlusion oracle's hit-test lands on the parent div and every clean case honestly fails — 0 scored rows, clone removed. Creative Tim material-dashboard (MIT, tag v3.1.0, commit `7938c15f`) wired as the 11th family: red-first family-key assertion observed failing before the config landed; real-Chromium proof grid `cli.ts corpus material-dashboard,sb-admin-2 360,1280` over all 14 variants — 56 planned → 7 reason-carrying skips → 49 scored rows (21 material-dashboard, 102 non-null labels), with missing-element honestly `unstable-case` ×2 (the `my-auto`-centered card moves every input box when the control is removed — a genuine template property) and 5 intermittent `page.goto` 30 s timeouts on the template's remote subresources (the first family with remote assets; recorded per case). Evidence retained sanitized at `docs/evidence/VISUAL-SLM/corpus-scale-2026-09-10-s3/` (sidecars parse, leak scan clean, vision-model identity read confirms the page and its masks). Dispositions: observed; `noTeacherCalls: true`; promotion stays `blocked-experimental-model`. **M0 gates green.** Next: #557 — 11-family full-registry re-capture (4 widths, koel/directus included), then the still-open owner call on the C3 unit. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### changed`

```
- CORPUS-SCALE-557-S3 11th corpus family (refs #557): `STATIC_FAMILY_CONFIG` gains
  Creative Tim's material-dashboard sign-in page (MIT, tag v3.1.0 pinned; control
  `button.bg-gradient-primary`, no viewport pin). Real-Chromium proof grid over all
  14 variants against material-dashboard + sb-admin-2: 56 planned → 7 reason-carrying
  skips → 49 scored rows (21 from the new family). The family's missing-element cases
  are honestly unstable (a centered card moves every input when the control is
  removed), and its remote subresources intermittently exceed the navigation
  deadline — both recorded as reasons in the corpus manifest. A first candidate
  (StartBootstrap coming-soon) was rejected without patching: its `disabled` submit
  button is not hittable, so the occlusion oracle fails every case honestly.
```

## 4. `VERSION` bump required?

no — corpus family config is internal evidence tooling, not user-observable product behavior.

## 5. Evidence pointers

- Red-first: `apps/web/src/compact-visual/corpus-families.test.ts` — observed failing on
  the missing 11th-family key (six-family assertion) before the config change; green after.
- Real-world proof: `cli.ts corpus material-dashboard,sb-admin-2 360,1280` (run dir
  local-only, `/tmp/corpus-md-full-zlta`) — real Chromium; 56 planned, 49 scored rows,
  7 reason-carrying skips, `parityMaximumError` 2.6e-7, promotion `blocked-experimental-model`.
- Retained sanitized: `docs/evidence/VISUAL-SLM/corpus-scale-2026-09-10-s3/` — corpus
  manifests + 3 representative material-dashboard cases (privacy sidecars, sanitized
  timelines); 6/6 sidecars parse; credential-shaped-content scan clean; independent
  vision-model identity read of the 1280 clean capture (page identity, in-frame control,
  masks present, no visible secrets).
- Candidate rejection: coming-soon hit-test probe (local-only, uncommitted) —
  `document.elementFromPoint` at the button's center returns `DIV.col-auto` at both
  widths; recorded in the evidence summary, clone removed.
- Gates: typecheck ☑ · lint ☑ · format ☑ (full repo, after this note) · test
  (corpus-families green; compact-visual suite green) ☑ · license gate ☑ (MIT template,
  local-only clone)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                          | Expected disposition                                                                      | Test                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Family key missing from `STATIC_FAMILY_CONFIG`   | red test on the six-family key list                                                       | `corpus-families.test.ts` (observed red → green) |
| Control not hittable as shipped (coming-soon)    | occlusion oracle fails every case honestly; 0 scored rows; family rejected, never patched | real capture + hit-test probe (observed)         |
| Control removal re-centers a `my-auto` card      | missing-element cases skipped `unstable-case`, no fabricated rows                         | full-grid run (2 skips with reason, observed)    |
| Remote subresources stall past the load deadline | `case-error` skip carrying the goto timeout reason                                        | full-grid run (5 skips with reason, observed)    |
