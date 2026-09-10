# corpus-scale 2026-09-10 slice 4 — material-dashboard full-width grid (11-family registry accounting)

Retained sanitized subset of the real-Chromium corpus run that completes the
11-family registry accounting for register C3 (#557 slice 4). Run command
(local dev host, real Chromium through `cli.ts corpus`):

```
cli.ts corpus <tmpdir> material-dashboard,sb-admin-2 360,640,1024,1280   # all 14 variants
```

Result: 112 planned → 9 reason-carrying skips → **103 scored rows**
(material-dashboard 47 + sb-admin-2 56) carrying 317 non-null oracle labels
(material-dashboard alone: 210). `noTeacherCalls: true`;
`promotion: blocked-experimental-model`; `parityMaximumError` 3.8e-7.

## Registry-wide accounting (what this run adds to C3)

The ten-family full run of 2026-09-10 (`docs/evidence/VISUAL-SLM/corpus-scale-2026-09-10/`)
stands unchanged: 476 planned → 75 skips → 401 scored rows, 1,778 non-null
labels. This run adds the eleventh family at the full width grid:

| Scope            | Planned | Skips (all reasoned) | Scored rows | Non-null labels |
| ---------------- | ------- | -------------------- | ----------- | --------------- |
| 10 families (S2) | 476     | 75                   | 401         | 1,778           |
| material-dashboard (S4) | 56 | 9                 | 47          | 210             |
| **11-family registry** | **532** | **84**         | **448**     | **1,988**       |

Residual to the ≥1,000 bar under the rows unit: **≥552 scored rows**.

## Skip taxonomy for the new family (every skip carries its reason)

- `missing-element` × 4 — `unstable-case`, exactly one per width: the card is
  vertically centered (`my-auto`), so removing the control shrinks the card and
  auto-margins move every input box; the privacy-mask stability contract refuses
  the case. A genuine template property.
- `page.goto` 30 s timeouts × 5 (`clean` ×2, `clip-right-25`, `clip-right-50`,
  `layout-shift`) — remote subresources (unsplash hero image, Google Fonts)
  intermittently exceed the navigation deadline. material-dashboard is the only
  registry family with remote assets.
- sb-admin-2 scored 56/56 in the same run (no skips), bounding the instability
  to the new family.

## Sanitization

- Every retained PNG has a `.privacy.json` sidecar (4/4 parse); the runs mask
  inputs and the remember-me checkbox with the pipeline's opaque magenta boxes.
- Timelines carry `*-timeline.sanitization.json` provenance; a grep scan over
  the retained files shows no credential-shaped content.
- The 360/1280 identity check from slice 3 (`corpus-scale-2026-09-10-s3/`)
  covers this family's page identity; no new page was introduced here.

## What this evidence does NOT show

- A single unified 11-family capture: the totals above sum two labeled runs on
  the same day. The row/label/skip counts are additive observations, not one
  plan; the register records them as such.
- No model claims: deterministic predicates only; promotion untouched.
