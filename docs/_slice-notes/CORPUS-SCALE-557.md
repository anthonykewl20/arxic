# CORPUS-SCALE-557 — staged doc updates (charter §10.2)

Issue: #557 · PR: _this PR_ · Disposition: observed (slice 1 of 2 — 10th family wired and proven; the ≥1,000-region scaled capture is slice 2)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #557 | [CORPUS-SCALE-557] corpus scale: 10 families toward the 1,000-region bar | ◐ in progress |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-10 | **#557 (CORPUS-SCALE-557) slice 1: 10th corpus family (sb-admin-2) wired and proven.** Red-first: `corpus-families.test.ts` now pins five static families and failed on the missing `sb-admin-2` key before the config landed. Real-world proof: `cli.ts corpus` with real Chromium captured sb-admin,sb-admin-2 at 360/1280 across clean/clip-right-50/missing-element — 12/12 rows, 0 skips, all six sb-admin-2 cases oracle-adjudicated (clean=controlled-negative, clip=1 with measuredClip 0.5, missing-element element label 1) with before/current PNGs + privacy sidecars + sanitized timelines. Dispositions: observed (no model claims; promotion stays blocked-experimental-model). **M0 gates green.** Next: #557 slice 2 — scaled capture toward ≥1,000 adjudicated regions across the 10 families. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### changed`

```
- CORPUS-SCALE-557 10th corpus family (refs #557): `STATIC_FAMILY_CONFIG` gains the
  StartBootstrap SB Admin 2 login family (docroot `sb-admin-2`, control
  `a.btn-primary.btn-user`, no viewport pin — the page is responsive). Real-world
  proof: `cli.ts corpus` captured the family with real Chromium at 360/1280 across
  clean/clip-right-50/missing-element; all six cases oracle-adjudicated as expected
  (12/12 rows, 0 skips). The ≥1,000-region corpus-scale capture remains open on #557.
```

## 4. `VERSION` bump required?

no — corpus family config is internal evidence tooling, not user-observable product behavior.

## 5. Evidence pointers

- Red-first: `apps/web/src/compact-visual/corpus-families.test.ts` — observed failing on the
  missing `sb-admin-2` key (five-family assertion) before the config change; green after.
- Real-world proof: `cli.ts corpus <dir> sb-admin,sb-admin-2 360,1280 clean,clip-right-50,missing-element`
  — real Chromium served the read-only local clone (`thirdparty-dg/public-families/sb-admin-2`,
  StartBootstrap MIT, commit f0309881); run dir `/tmp/corpus-sb2-xJ8d` (local, uncommitted):
  12 rows, 0 skips, 48 sb-admin-2 artifacts (before/current PNGs, `.privacy.json` sidecars,
  `*-timeline.sanitization.json` provenance).
- Screenshot identity: the 1280 clean current-PNG shows the SB Admin 2 login card with the
  `a.btn-primary.btn-user` submit fully above the fold (independent vision-model read);
  form fields carry the pipeline's standard magenta privacy redaction.
- Known cosmetic gap (observed, register-irrelevant): the template's left card background
  image does not paint offline; oracles and the control do not depend on it.
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (corpus-families 1/1; full suite green on
  base d87fb56a at shift N) ☑ · license gate ☑ (MIT template, local-only clone)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                        | Expected disposition                                                                                                         | Test                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Family key missing from `STATIC_FAMILY_CONFIG` | red test on the five-family key list                                                                                         | `corpus-families.test.ts` (observed red → green)   |
| Single-family corpus plan                      | `insufficient-families` rejection before any capture                                                                         | `validateCorpusPlan` (observed via CLI)            |
| Non-unique control selector risk               | selector pinned to the only `btn-primary` anchor (`a.btn-primary.btn-user`); Google/Facebook anchors carry different classes | sb-admin-2 assertions in `corpus-families.test.ts` |
