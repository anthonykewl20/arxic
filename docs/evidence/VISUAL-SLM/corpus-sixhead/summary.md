# Six-head nine-family corpus — 2026-09-08 (refs #423)

Owner directive ("do all and fix all gaps and blockers") unlocked pilot-family
expansion. Truth state of every number below: **observed** (never verified;
human inspection pending).

## Roster and provenance

Nine contributing application families, all real apps driven by real Chromium:

| family | source | viewport | notes |
| --- | --- | --- | --- |
| next | repo fixture reference-auth-app /login | 800+1280 | |
| express | repo fixture vulnerable-auth-app / | 800+1280 | |
| arxic | workbench login (real server) | 800+1280 | |
| koel | docker koel-php83:rehearsal | 800+1280 | 2 transient control timeouts (skipped, logged) |
| directus | docker directus-node22:rehearsal /admin | 800+1280 | SPA shell: overflow-x and text-truncate rows refused by oracle (skipped) |
| todomvc | public clone `tastejs/todomvc@ff43b02e`, javascript-es5 | 800+1280 | control is `input.new-todo` (masked ⇒ move-mutations unstable by privacy contract — honest skips) |
| gentelella | public clone `ColorlibHQ/gentelella@d0064ca2` | 1280 | page scrolls horizontally at every practical width ⇒ 0 usable rows (finding below) |
| sb-admin | public clone `StartBootstrap/startbootstrap-sb-admin@adde34b9` dist | 800+1280 | login "button" is an anchor styled as a button |
| adminlte | public clone AdminLTE `v3.2.0@bd4d9c72` starter | 1280 | index pages hold every real button below the fold at 800 |

Attempted and excluded, with reasons recorded:

- **mailpit** (`axllent/mailpit:v1.30.0`, docker): the sidebar "Delete all"
  button is pointer-intercepted by a transparent overlay in the shipped UI —
  `elementFromPoint` at its center never returns the button on an unmutated
  page, so every controlled case contradicts the occlusion oracle. That is a
  real observation about mailpit's UI, not a corpus bug; the family is
  excluded rather than mislabeled.
- **gentelella**: intrinsically horizontal-scrolling fixed layout ⇒ the
  overflow oracle refuses unmutated pages. 0 rows.

Clones live local-only under `thirdparty-dg/public-families` (commit-pinned);
they are never committed to this repository.

## Capture

- 178 cases retained; 47 skipped, every skip with its reason in
  `corpus-v2.json` (unstable privacy-mask geometry for move/remove variants on
  masked-input controls; `no-text-element` where the widest h1/h2/p is under
  80px; oracle contradictions; two transient koel control timeouts).
- Viewports 800 and 1280; frozen family allocation seed 423 (families never
  split): train {express, directus, adminlte, arxic, gentelella*},
  calibration {sb-admin, next}, test {todomvc, koel}. *gentelella allocated a
  train slot but contributed 0 rows.
- Fresh capture session dated 2026-09-08 — same-window as training; a truly
  chronological holdout still requires a later capture date.

## Training and evaluation (untouched test families: todomvc + koel)

- 178 rows; Python/native parity maximum error 2.3e-7 (≤1e-5 gate).
- All six heads have positives and negatives (supported), but calibration
  qualifiers differ: **occlusion 0.799, missing_element 0.748, overflow 0.868
  thresholds calibrated; clipping / text_truncation / layout_shift honestly
  disabled** — the new-head rows are hard negatives for clipping (moved,
  occluded or removed controls score like clipped ones on a 178-row corpus)
  and no candidate meets the precision/recall gates. Shipping a miscalibrated
  threshold is prohibited; the disabled state is the design working.
- Test-split metrics (Wilson 95% intervals in `corpus-report.json`):
  - **occlusion: 4/4 recall, 0 false positives** on untouched families.
  - missing_element: 0 positives exist in this test split (the two test
    families' removal variants skip on mask geometry) — recall not computable,
    28 negatives correctly held.
  - clipping: 8 positives all unresolved (head disabled) — counted as
    unresolved misses, not correct negatives.
- `promotion: blocked` with blockers `experimental-model`,
  `independent-application-quality-gates-not-established`, `full-vps-not-measured`.

## Reproduce

```
pnpm --filter @arxic/web exec tsx <driver>   # captureCorpusV2(9 families, [800,1280], 14 variants) + trainCorpusV2
```

Driver retained in the slice note; corpus artifacts under
`/tmp/arxic-423-corpus-sixhead` (local-only; this directory keeps the report,
manifest, console and one named screenshot per new head).
