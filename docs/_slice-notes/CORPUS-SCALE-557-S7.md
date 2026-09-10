# CORPUS-SCALE-557-S7 — staged doc updates (charter §10.2)

Issue: #557 · PR: _this PR_ · Disposition: observed (slice 7 — the 14th family
captured at the full width grid; register C3 carries the 14-family accounting;
the ≥1,000-row bar stays open with residual ≥267)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #557 | [CORPUS-SCALE-557] corpus scale: 14 families toward the 1,000-region bar | ◐ in progress |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-10 (10) | **#557 (CORPUS-SCALE-557-S7) slice 7: 14-family registry accounting — now-ui-kit at the full width grid.** Creative Tim's now-ui-kit (MIT LICENSE.md, plain static kit, commit-pinned 80acd17, local-only clone at docroot `now-ui-kit`) probed clean at 360/640/1024/1280 — the login card's "Get Started" control is an anchor styled as a button (sb-admin precedent) and the only `btn-primary` anchor page-wide, hit test lands on it, no native overflow, missing-element stable on the clean page. Real Chromium through `cli.ts corpus now-ui-kit,sb-admin-2 360,640,1024,1280` over all 14 variants: 112 planned → 30 reason-carrying skips → 82 scored rows (now-ui-kit 26 + sb-admin-2 56/56, 388 non-null labels; now-ui-kit 144). Skip taxonomy, all now-ui-kit: `unstable-case` ×24 — every clipping mutation (clip-full, clip-right-75/50/25, clip-bottom-50) and layout-shift at all four widths: the card sits over a full-screen header and those mutations re-flow it, so the stability oracle fails after mutation even though the clean page probed stable — the first family where the clean-page probe under-predicted mutation stability, a lesson recorded for future probes; `overflow-oracle-failed` ×2 (style-tweak at 360/640 only); `no-text-element` ×4 (text-truncate at all widths: widest h1/h2/p = 62px, under the 80px floor). Register C3 updated: registry totals across the five labeled runs are 868 planned → 135 skips → **733 scored rows across 14 families, 3,258 non-null oracle labels** (additive observations, not one plan); residual under the rows unit **≥267**. Evidence `docs/evidence/VISUAL-SLM/corpus-scale-2026-09-10-s7/` (sanitized, 6/6 sidecars parse, leak scan clean). Dispositions: observed; `noTeacherCalls: true`; promotion stays `blocked-experimental-model`. **M0 gates green.** Next: #557 — further registry growth or the owner's C3 unit ruling; both recorded in the register. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### changed`

```
- CORPUS-SCALE-557-S7 14-family registry accounting (refs #557): `STATIC_FAMILY_CONFIG`
  gains Creative Tim's now-ui-kit login family (docroot `now-ui-kit`, control
  `a.btn-primary` — an anchor styled as a button, the sb-admin precedent, and
  the only btn-primary anchor page-wide; no viewport pin; MIT, a static kit
  commit-pinned at 80acd17). Real-world proof: `cli.ts corpus` captured the
  family with real Chromium at the full width grid × 14 variants — 112 planned
  → 30 reason-carrying skips → 26 scored rows with sb-admin-2 scoring a
  perfect 56/56 in the same run. The honest divergence is recorded: the
  clean-page probe passed missing-element stability at every width, but every
  clipping mutation and layout-shift destabilizes the grid cases (`unstable-case`
  ×24 — the card sits over a full-screen header and those mutations re-flow
  it), plus style-tweak `overflow-oracle-failed` ×2 at narrow widths and the
  predicted `no-text-element` ×4 (widest h1/h2/p = 62px, under the 80px
  floor). Clean-page probes measure the clean oracle only; mutation-variant
  stability is knowable only from the full grid. Register C3 now records the
  14-family totals (868 planned → 135 skips → 733 scored rows, 3,258 non-null
  oracle labels across five labeled runs) and the honest residual (≥267 rows)
  under the unchanged rows-unit reading. Evidence retained sanitized under
  `docs/evidence/VISUAL-SLM/corpus-scale-2026-09-10-s7/`.
```

## 4. `VERSION` bump required?

no — corpus/evidence bookkeeping plus a test-only config registry for local
visual-corpus capture; not user-observable product behavior.

## 5. Evidence pointers

- Real-world proof: `cli.ts corpus now-ui-kit,sb-admin-2 360,640,1024,1280`
  (run dir local-only, `/tmp/corpus-s7-AKCi`) — real Chromium; exit 0;
  summary JSON rows 82, skipped 30, parityMaximumError 2.8e-7, promotion
  `blocked-experimental-model`.
- Red-first: `apps/web/src/compact-visual/corpus-families.test.ts` failed on
  the missing `now-ui-kit` key before the config entry landed, then passed
  (`1 passed`).
- Pre-wiring probe (local-only `/tmp/probe-nuk.mjs`): real Chromium over the
  static clone at all four widths — exactly one visible `a.btn-primary`, hit
  test on the control, no horizontal overflow, missing-element stable.
- Retained sanitized: `docs/evidence/VISUAL-SLM/corpus-scale-2026-09-10-s7/` —
  corpus-v2.json + corpus-report.json + 3 representative now-ui-kit cases
  (360-clean, 640-missing-element, 1280-clean; before/current PNGs with
  privacy sidecars, sanitized timelines); 6/6 sidecars parse; leak scan
  (credential-shaped content + local paths) zero-hit.
- Register: `docs/release-gates/undischarged-gates.md` C3 — slice-7 bullet
  with the 14-family totals and the residual.
- Gates: typecheck ☑ · lint ☑ · format ☑ (`All matched files use Prettier
code style!` on the full repo, after this note) · test ☑ (full suite:
  2,326 passed / 5 files errored on `spawn rustc ENOENT` — the runner shell
  lacked `~/.cargo/bin` on PATH; the same 5 files re-run with the toolchain
  on PATH: 5 files / 6 tests passed in 39s; no assertion failed anywhere) ·
  license gate ☑ (repo `license: MIT`, no third-party code vendored; family
  clones stay local-only)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                       | Expected disposition                                                                           | Test                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Clipping/layout-shift mutation applied        | `unstable-case` skip with reason — stability oracle fails after mutation; row never fabricated | corpus grid run, 24 skips observed           |
| Style tweak overflows at 360/640              | `overflow-oracle-failed` skip with reason                                                      | corpus grid run, 2 skips observed            |
| No h1/h2/p text ≥80px range width             | text-truncate variant refuses `no-text-element`, recorded per case                             | corpus grid run, 4 skips observed            |
| Family key absent from `STATIC_FAMILY_CONFIG` | config test red (asserted key set), registry capture would misroute                            | `corpus-families.test.ts` (red-first, green) |
