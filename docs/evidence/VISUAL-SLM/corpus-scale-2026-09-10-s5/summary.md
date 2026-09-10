# corpus-scale 2026-09-10 slice 5 — material-kit at the full width grid (12-family registry accounting)

Retained sanitized subset of the real-Chromium corpus run that grows the
registry to 12 families for register C3 (#557 slice 5). Run command
(local dev host, real Chromium through `cli.ts corpus`):

```
cli.ts corpus <tmpdir> material-kit,sb-admin-2 360,640,1024,1280   # all 14 variants
```

Result: 112 planned → 17 reason-carrying skips → **95 scored rows**
(material-kit 39 + sb-admin-2 56) carrying 418 non-null oracle labels
(material-kit alone: 174). `noTeacherCalls: true`;
`promotion: blocked-experimental-model`; `parityMaximumError` 5.3e-7.

## Registry-wide accounting (what this run adds to C3)

The eleven-family totals (ten-family full run + the slice-4 material-dashboard
grid, `docs/evidence/VISUAL-SLM/corpus-scale-2026-09-10*/`) stand unchanged.
This run adds the twelfth family at the full width grid:

| Scope                    | Planned | Skips (all reasoned) | Scored rows | Non-null labels |
| ------------------------ | ------- | -------------------- | ----------- | --------------- |
| 11 families (S2 + S4)    | 532     | 84                   | 448         | 1,988           |
| material-kit (S5)        | 112     | 17                   | 95          | 418             |
| **12-family registry**   | **644** | **101**              | **543**     | **2,406**       |

Residual to the ≥1,000 bar under the rows unit: **≥457 scored rows**.

## Skip taxonomy for the new family (every skip carries its reason)

- `overflow-oracle-failed` × 12 — the entire 1024 width grid, `clean`
  included: the unmutated sign-in page natively overflows horizontally at
  1024, which would contradict the overflow oracle on unmutated pages. The
  width is refused honestly (same skip class as the ten-family run's
  wide-dashboard pins).
- `missing-element` `unstable-case` × 3 (360, 640, 1024) — like
  material-dashboard, the card is vertically centered (`my-auto`), so removing
  the control re-centers the card and moves every input box; the privacy-mask
  stability contract refuses the case. A genuine template property.
- `case-error` × 2 (1280 `style-tweak`, 1280 `missing-element`) —
  `ScreenshotPrivacyError: ARXIC-SCREENSHOT-PNG-INVALID: PNG browser chunk
  inventory is invalid`: the screenshot privacy guard rejected a Chromium PNG
  whose chunk inventory did not parse and failed the case closed instead of
  retaining a corrupt image. First observation of this class in the corpus
  runs; recorded, not retried into compliance.
- sb-admin-2 scored 56/56 in the same run (no skips), bounding the
  instability to the new family.

## Sanitization

- Every retained PNG has a `.privacy.json` sidecar (6/6 parse); the runs mask
  inputs with the pipeline's opaque magenta boxes.
- Timelines carry `*-timeline.sanitization.json` provenance; a grep scan over
  the retained files shows no credential-shaped content and no local
  filesystem paths.
- The 360/1280 identity check from slice 3 (`corpus-scale-2026-09-10-s3/`)
  covers this family's page shape (same Creative Tim vendor); the family's
  control differs (`button.bg-gradient-dark`, the page's only such button —
  the navbar CTA with the same class is an anchor).

## What this evidence does NOT show

- A single unified 12-family capture: the totals above sum three labeled runs
  on the same day. The row/label/skip counts are additive observations, not
  one plan; the register records them as such.
- No model claims: deterministic predicates only; promotion untouched.
