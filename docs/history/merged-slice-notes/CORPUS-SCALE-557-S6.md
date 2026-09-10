# CORPUS-SCALE-557-S6 — staged doc updates (charter §10.2)

Issue: #557 · PR: _this PR_ · Disposition: observed (slice 6 — the 13th family
captured at the full width grid; register C3 carries the 13-family accounting;
the ≥1,000-row bar stays open with residual ≥349)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #557 | [CORPUS-SCALE-557] corpus scale: 13 families toward the 1,000-region bar | ◐ in progress |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-10 (9) | **#557 (CORPUS-SCALE-557-S6) slice 6: 13-family registry accounting — adminbsb at the full width grid.** AdminBSB - Material Design (MIT, plain no-build template, commit-pinned e5d39b8, local-only clone at docroot `adminbsb`) probed clean at 360/640/1024/1280 — unique hittable enabled `button.bg-pink` sign-in submit, no native overflow, missing-element stable (no centered-card recentering) — the first family with no instability skips at all. Real Chromium through `cli.ts corpus adminbsb,sb-admin-2 360,640,1024,1280` over all 14 variants: 112 planned → 4 reason-carrying skips → 108 scored rows (adminbsb 52 + sb-admin-2 56/56, 464 non-null labels; adminbsb alone 220). Skip taxonomy: the text-truncate variant refuses `no-text-element` exactly once per width (the page carries no h1/h2/p; its intro text lives in a div.msg) — the same class the ten-family run recorded 8 times. Register C3 updated: registry totals across the four labeled runs are 756 planned → 105 skips → **651 scored rows across 13 families, 2,870 non-null oracle labels** (additive observations, not one plan); residual under the rows unit **≥349**. Evidence `docs/evidence/VISUAL-SLM/corpus-scale-2026-09-10-s6/` (sanitized, 6/6 sidecars parse, leak scan clean). Dispositions: observed; `noTeacherCalls: true`; promotion stays `blocked-experimental-model`. **M0 gates green.** Next: #557 — further registry growth (~7–9 more families to the bar under the rows unit at observed per-family yields) or the owner's C3 unit ruling; both recorded in the register. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### changed`

```
- CORPUS-SCALE-557-S6 13-family registry accounting (refs #557): `STATIC_FAMILY_CONFIG`
  gains the AdminBSB - Material Design sign-in family (docroot `adminbsb`,
  control `button.bg-pink` — the only bg-pink element in the page; no viewport
  pin; MIT, a plain no-build template commit-pinned at e5d39b8). Real-world
  proof: `cli.ts corpus` captured the family with real Chromium at the full
  width grid × 14 variants — 112 planned → 4 reason-carrying skips → 52 scored
  rows with sb-admin-2 scoring a perfect 56/56 in the same run. The family
  probed clean at every width (unique hittable enabled control, no native
  overflow, missing-element stable), so its only skips are the honest
  `no-text-element` refusals of the text-truncate variant — the page carries
  no h1/h2/p, its intro text living in a div.msg. Register C3 now records the
  13-family totals (756 planned → 105 skips → 651 scored rows, 2,870 non-null
  oracle labels across four labeled runs) and the honest residual (≥349 rows)
  under the unchanged rows-unit reading. Evidence retained sanitized under
  `docs/evidence/VISUAL-SLM/corpus-scale-2026-09-10-s6/`.
```

## 4. `VERSION` bump required?

no — corpus/evidence bookkeeping plus a test-only config registry for local
visual-corpus capture; not user-observable product behavior.

## 5. Evidence pointers

- Real-world proof: `cli.ts corpus adminbsb,sb-admin-2 360,640,1024,1280`
  (run dir local-only, `/tmp/corpus-s6-j82g`) — real Chromium; exit 0;
  summary JSON rows 108, skipped 4, parityMaximumError 3.0e-7, promotion
  `blocked-experimental-model`.
- Red-first: `apps/web/src/compact-visual/corpus-families.test.ts` failed on
  the missing `adminbsb` key before the config entry landed, then passed
  (`1 passed`).
- Retained sanitized: `docs/evidence/VISUAL-SLM/corpus-scale-2026-09-10-s6/` —
  corpus-v2.json + corpus-report.json + 3 representative adminbsb cases
  (360-clean, 640-clip-full, 1280-clean scored; before/current PNGs with
  privacy sidecars, sanitized timelines); 6/6 sidecars parse; leak scan
  (credential-shaped content + local paths) zero-hit.
- Register: `docs/release-gates/undischarged-gates.md` C3 — slice-6 bullet
  with the 13-family totals and the residual.
- Gates: typecheck ☑ · lint ☑ · format ☑ (full repo, after this note) · test
  (`corpus-families.test.ts` green; the rest of the diff is
  docs/evidence-only) ☑ · license gate ☑

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                       | Expected disposition                                                         | Test                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| Page carries no h1/h2/p (text lives in a div)                 | text-truncate refused `no-text-element` once per width, never fabricated     | 4 skips with reason in corpus-v2.json (observed)         |
| Control removal on a card that does not re-center             | missing-element scored normally — zero unstable-case skips in the whole grid | corpus-v2.json per-variant counts (observed)             |
| A probe-clean family still records its one genuine limitation | skip taxonomy carries the no-text-element reason class per case              | corpus-v2.json skip reasons (observed)                   |
| Instability specific to one family                            | sb-admin-2 scores 56/56 in the same run, bounding the accounting             | corpus-v2.json per-family counts (observed)              |
| Bar unmet under the register's unit                           | reported, not padded; residual restated precisely (≥349)                     | register C3 slice-6 bullet + evidence summary (observed) |
