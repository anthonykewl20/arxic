# CORPUS-SCALE-557-S5 — staged doc updates (charter §10.2)

Issue: #557 · PR: _this PR_ · Disposition: observed (slice 5 — the 12th family
captured at the full width grid; register C3 carries the 12-family accounting;
the ≥1,000-row bar stays open with residual ≥457)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #557 | [CORPUS-SCALE-557] corpus scale: 12 families toward the 1,000-region bar | ◐ in progress |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-10 (8) | **#557 (CORPUS-SCALE-557-S5) slice 5: 12-family registry accounting — material-kit at the full width grid.** Real Chromium through `cli.ts corpus material-kit,sb-admin-2 360,640,1024,1280` over all 14 variants: 112 planned → 17 reason-carrying skips → 95 scored rows (material-kit 39 + sb-admin-2 56/56, 418 non-null labels; material-kit alone 174). Skip taxonomy: native horizontal overflow at 1024 refuses that whole width `overflow-oracle-failed` ×12 (clean included); missing-element `unstable-case` ×3 (the `my-auto`-centered card moves every input box when the control is removed); and a first corpus observation of the screenshot privacy guard failing two 1280 cases closed on `ARXIC-SCREENSHOT-PNG-INVALID` (a Chromium PNG whose chunk inventory did not parse is rejected, never retained). Register C3 updated: registry totals across the three labeled runs are 644 planned → 101 skips → **543 scored rows across 12 families, 2,406 non-null oracle labels** (additive observations, not one plan); residual under the rows unit **≥457**. Evidence `docs/evidence/VISUAL-SLM/corpus-scale-2026-09-10-s5/` (sanitized, 6/6 sidecars parse, leak scan clean). Dispositions: observed; `noTeacherCalls: true`; promotion stays `blocked-experimental-model`. **M0 gates green.** Next: #557 — further registry growth (~9–12 more families to the bar under the rows unit at observed per-family yields) or the owner's C3 unit ruling; both recorded in the register. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### changed`

```
- CORPUS-SCALE-557-S5 12-family registry accounting (refs #557): `STATIC_FAMILY_CONFIG`
  gains the Creative Tim material-kit sign-in family (docroot `material-kit`,
  control `button.bg-gradient-dark` — the page's only such button, the navbar
  CTA with the same class being an anchor; no viewport pin; commit-pinned at
  54cdbf81). Real-world proof: `cli.ts corpus` captured the family with real
  Chromium at the full width grid × 14 variants — 112 planned → 17
  reason-carrying skips → 39 scored rows with sb-admin-2 scoring a perfect
  56/56 in the same run. The family's genuine limitations are recorded as
  reasons, not fabricated rows: native horizontal overflow at 1024 (that
  width refused, `overflow-oracle-failed` ×12), the `my-auto` centered card's
  missing-element instability (`unstable-case` ×3), and a first observation of
  the screenshot privacy guard failing closed on an unparsable Chromium PNG
  (`ARXIC-SCREENSHOT-PNG-INVALID`, 2 case-errors). Register C3 now records the
  12-family totals (644 planned → 101 skips → 543 scored rows, 2,406 non-null
  oracle labels across three labeled runs) and the honest residual (≥457 rows)
  under the unchanged rows-unit reading. Evidence retained sanitized under
  `docs/evidence/VISUAL-SLM/corpus-scale-2026-09-10-s5/`.
```

## 4. `VERSION` bump required?

no — corpus/evidence bookkeeping plus a test-only config registry for local
visual-corpus capture; not user-observable product behavior.

## 5. Evidence pointers

- Real-world proof: `cli.ts corpus material-kit,sb-admin-2 360,640,1024,1280`
  (run dir local-only, `/tmp/corpus-s5-b3fC`) — real Chromium; exit 0; summary
  JSON rows 95, skipped 17, parityMaximumError 5.3e-7, promotion
  `blocked-experimental-model`.
- Red-first: `apps/web/src/compact-visual/corpus-families.test.ts` failed on
  the missing `material-kit` key before the config entry landed, then passed
  (`1 passed`).
- Retained sanitized: `docs/evidence/VISUAL-SLM/corpus-scale-2026-09-10-s5/` —
  corpus-v2.json + corpus-report.json + 3 representative material-kit cases
  (360-clean, 640-clip-full, 1280-clean scored; before/current PNGs with
  privacy sidecars, sanitized timelines); 6/6 sidecars parse; leak scan
  (credential-shaped content + local paths) zero-hit.
- Register: `docs/release-gates/undischarged-gates.md` C3 — slice-5 bullet
  with the 12-family totals and the residual.
- Gates: typecheck ☑ · lint ☑ · format ☑ (full repo, after this note) · test
  (`corpus-families.test.ts` green; the rest of the diff is
  docs/evidence-only) ☑ · license gate ☑

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                     | Expected disposition                                                                  | Test                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Unmutated page overflows horizontally at one width          | the whole width refused `overflow-oracle-failed`, clean included — never force-scored | 12 skips with reason in corpus-v2.json (observed)        |
| Control removal re-centers a `my-auto` card                 | missing-element skipped `unstable-case`, never fabricated                             | 3 skips with reason in corpus-v2.json (observed)         |
| Chromium returns a PNG whose chunk inventory does not parse | the privacy guard fails the case closed; no corrupt image retained                    | 2 case-errors with reason in corpus-v2.json (observed)   |
| Instability specific to one family                          | sb-admin-2 scores 56/56 in the same run, bounding the instability                     | corpus-v2.json per-family counts (observed)              |
| Bar unmet under the register's unit                         | reported, not padded; residual restated precisely (≥457)                              | register C3 slice-5 bullet + evidence summary (observed) |
