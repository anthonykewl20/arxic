# corpus-scale 2026-09-10 slice 6 — adminbsb at the full width grid (13-family registry accounting)

Retained sanitized subset of the real-Chromium corpus run that grows the
registry to 13 families for register C3 (#557 slice 6). Run command
(local dev host, real Chromium through `cli.ts corpus`):

```
cli.ts corpus <tmpdir> adminbsb,sb-admin-2 360,640,1024,1280   # all 14 variants
```

Result: 112 planned → 4 reason-carrying skips → **108 scored rows**
(adminbsb 52 + sb-admin-2 56) carrying 464 non-null oracle labels
(adminbsb alone: 220). `noTeacherCalls: true`;
`promotion: blocked-experimental-model`; `parityMaximumError` 3.0e-7.

The new family is AdminBSB - Material Design (MIT per its README, a plain
no-build HTML template, local-only clone commit-pinned at `e5d39b8`,
default-branch HEAD). A real-Chromium probe before wiring confirmed, at all
four widths: exactly one visible button (the enabled submit
`button.bg-pink`, unique page-wide), the hit test landing on the button
itself, no horizontal overflow, and missing-element stability — the card
does not re-center when the control is removed, the cleanest oracle profile
of any family in the registry.

## Registry-wide accounting (what this run adds to C3)

The twelve-family totals (ten-family full run + material-dashboard + the
slice-5 material-kit grid, `docs/evidence/VISUAL-SLM/corpus-scale-2026-09-10*/`)
stand unchanged. This run adds the thirteenth family at the full width grid:

| Scope                  | Planned | Skips (all reasoned) | Scored rows | Non-null labels |
| ---------------------- | ------- | -------------------- | ----------- | --------------- |
| 12 families (S2+S4+S5) | 644     | 101                  | 543         | 2,406           |
| adminbsb (S6)          | 112     | 4                    | 108         | 464             |
| **13-family registry** | **756** | **105**              | **651**     | **2,870**       |

Residual to the ≥1,000 bar under the rows unit: **≥349 scored rows**.

## Skip taxonomy for the new family (every skip carries its reason)

- `no-text-element` × 4 — the text-truncate variant only, exactly one per
  width: the sign-in page carries no `h1`/`h2`/`p` element (its intro text
  lives in a `div.msg`), so the truncation seam has nothing to clamp. The
  same skip class the ten-family run recorded 8 times.
- No other skip class fired: unlike the two Creative Tim families, neither
  missing-element instability nor native overflow nor navigation timeouts
  appeared anywhere in the grid.
- sb-admin-2 scored 56/56 in the same run (no skips), bounding the
  accounting to the same control family as slices 4–5.

## Sanitization

- Every retained PNG has a `.privacy.json` sidecar (6/6 parse); the runs
  mask the username/password inputs and the remember-me checkbox with the
  pipeline's opaque magenta boxes.
- Timelines carry `*-timeline.sanitization.json` provenance; a grep scan
  over the retained files shows no credential-shaped content and no local
  filesystem paths.

## What this evidence does NOT show

- A single unified 13-family capture: the totals above sum four labeled runs
  on the same day. The row/label/skip counts are additive observations, not
  one plan; the register records them as such.
- No model claims: deterministic predicates only; promotion untouched.
