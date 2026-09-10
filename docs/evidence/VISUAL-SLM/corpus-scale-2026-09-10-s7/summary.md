# corpus-scale 2026-09-10 slice 7 — now-ui-kit at the full width grid (14-family registry accounting)

Retained sanitized subset of the real-Chromium corpus run that grows the
registry to 14 families for register C3 (#557 slice 7). Run command
(local dev host, real Chromium through `cli.ts corpus`):

```
cli.ts corpus <tmpdir> now-ui-kit,sb-admin-2 360,640,1024,1280   # all 14 variants
```

Result: 112 planned → 30 reason-carrying skips → **82 scored rows**
(now-ui-kit 26 + sb-admin-2 56) carrying 388 non-null oracle labels
(now-ui-kit 144 of its 156 non-null slots; sb-admin-2 244 of 336 — the
remaining slots are heads that do not apply per case, in both families).
`noTeacherCalls: true`; `promotion: blocked-experimental-model`;
`parityMaximumError` 2.8e-7.

The new family is Creative Tim's now-ui-kit (MIT `LICENSE.md`, a plain
no-build static kit, local-only clone commit-pinned at `80acd17`,
default-branch HEAD). Its login card's "Get Started" control is an anchor
styled as a button — the sb-admin precedent — and the only `btn-primary`
anchor page-wide, so the class selector stays unique.

## Honest divergence: the clean-page probe under-predicted mutation stability

The pre-wiring real-Chromium probe (clean page only) confirmed, at all four
widths: exactly one visible primary anchor, hit test landing on it, no
horizontal overflow, and missing-element stability — the card holds its
position when the control is removed. The full grid then showed that this
stability does **not** survive the mutation variants: 24 of the 30 skips are
`unstable-case`, covering every clipping mutation (clip-full, clip-right-75,
clip-right-50, clip-right-25, clip-bottom-50) and layout-shift, each at all
four widths. After those mutations are applied, removing the control re-flows
the card, so the before/after stability oracle fails. The card sits over a
full-screen header, and the clipping/shifting mutations perturb that layout.
The lesson is recorded for future slices: clean-page probes measure the clean
oracle only; mutation-variant stability is knowable only from the full grid.

## Skip taxonomy for the new family (every skip carries its reason)

| Reason                    | Count | Cases                                                                  |
| ------------------------- | ----- | ---------------------------------------------------------------------- |
| `unstable-case`           | 24    | clip-full, clip-right-75/50/25, clip-bottom-50, layout-shift × 4 widths |
| `overflow-oracle-failed`  | 2     | style-tweak at 360 and 640                                              |
| `no-text-element`         | 4     | text-truncate at all 4 widths (widest h1/h2/p = 62px, under the 80px floor) |

The `no-text-element` refusals were predicted by the probe and are the same
honest refusal recorded for other families. The 26 scored rows across clean,
content-change, missing-element, occlusion-overlay, overflow-x,
overlay-adjacent (all four widths) and style-tweak (1024, 1280 only) are the
weakest per-family yield in the 14-family registry, but every one is a real
scored case and every skip names its reason — recorded, never fabricated.

## Registry-wide accounting (what this run adds to C3)

The thirteen-family totals (ten-family full run + material-dashboard +
slice-5 material-kit + slice-6 adminbsb,
`docs/evidence/VISUAL-SLM/corpus-scale-2026-09-10*/`) stand unchanged. This
run adds the fourteenth family at the full width grid:

| Scope                       | Planned | Skips (all reasoned) | Scored rows | Non-null labels |
| --------------------------- | ------- | -------------------- | ----------- | --------------- |
| 13 families (S2+S4+S5+S6)   | 756     | 105                  | 651         | 2,870           |
| now-ui-kit (S7)             | 112     | 30                   | 82          | 388             |
| **14-family registry**      | **868** | **135**              | **733**     | **3,258**       |

Residual to the ≥1,000 bar under the rows unit: **≥267 scored rows**. At
observed per-family yields that is roughly 5–6 adminbsb-grade families or
10+ now-ui-kit-grade ones; the bar remains open pending the owner's
rows-vs-labels unit ruling.

## Retained subset (sanitized, ADR §15)

`corpus-v2.json`, `corpus-report.json`, and three representative now-ui-kit
cases (360-clean, 640-missing-element, 1280-clean) with before/current PNGs,
per-case JSON, scene, sanitized action timeline, and adjacent
sanitization provenance. All six retained sidecars parse as JSON; a leak
scan over the retained files (local paths, clone names, credentials) found
zero hits.
