# corpus-scale 2026-09-10 slice 3 — material-dashboard 11th family proof

Retained sanitized subset of the real-Chromium corpus run that proves the
`material-dashboard` family (part of #557 slice 3). Run command (local dev
host, real Chromium through `cli.ts corpus`):

```
cli.ts corpus <tmpdir> material-dashboard,sb-admin-2 360,1280   # all 14 variants
```

Result: 56 planned → 7 reason-carrying skips → **49 scored rows** (21
material-dashboard + 28 sb-admin-2) carrying 153 non-null oracle labels
(material-dashboard alone: 102). `noTeacherCalls: true`;
`promotion: blocked-experimental-model`; `parityMaximumError` 2.6e-7.

## Family provenance

- Creative Tim **material-dashboard**, MIT (`LICENSE.md`), pinned to tag
  `v3.1.0`, commit `7938c15f4297fa83e5fd43080014ae7be8a95474`; local-only
  clone under `thirdparty-dg/public-families/` (never committed).
- Page: `pages/sign-in.html` from the static v3.1.0 build; control
  `button.bg-gradient-primary` (the page's only bg-gradient-primary button).

## Skip taxonomy (every skip carries its reason in corpus-v2.json)

| Variant         | Count | Reason                                                                            |
| --------------- | ----- | --------------------------------------------------------------------------------- |
| missing-element | 2     | `unstable-case` — the card is vertically centered (`my-auto`), so removing the control shrinks the card and auto-margins move every input box (~44 px); the privacy-mask stability contract refuses the case. A genuine template property, not a pipeline defect. |
| (mixed)         | 5     | `case-error: page.goto` 30 s timeouts — material-dashboard is the first family whose page references remote subresources (unsplash hero image, Google Fonts); slow loads intermittently exceed the `load` deadline. Recorded per case; no mislabeled rows. |

## Candidate honesty record

StartBootstrap **coming-soon** (MIT, commit `5c428101c48f34b85bf45e4faf26476b2f43215d`)
was cloned first and **rejected without patching**: its shipped submit button
carries Bootstrap's `disabled` class → `pointer-events: none` → the occlusion
oracle's hit-test at the control's center lands on the parent `div.col-auto`,
so every clean case honestly fails and the family contributes 0 scored rows.
The clone was removed; the corpus never mutates a family clone to pass oracles.

## Sanitization

- Every retained PNG has a `.privacy.json` sidecar (6/6 parse); both inputs and
  the remember-me checkbox are magenta-masked in the captured frames.
- Timelines carry `*-timeline.sanitization.json` provenance; a grep scan over
  the retained files shows no credential-shaped content.
- An independent vision-model read of `material-dashboard-1280-clean-current.png`
  confirmed the page identity (Material Dashboard 2 sign-in, control fully
  in-frame, masks present, no visible secrets).

## What this evidence does NOT show

- A full-registry re-capture: the ten-family 2026-09-10 numbers in register C3
  predate this family; an 11-family full-grid re-capture (koel/directus included,
  4 widths) remains owed on #557.
- No model claims: deterministic predicates only; promotion untouched.
