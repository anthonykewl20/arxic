# WEB-445-READABILITY — staged doc updates (charter §10.2)

Issue: #445 · PR: pending · Disposition: mixed (acceptance in progress)

## 1. `docs/SYNC.md` — tracker row

```text
| #445 | [WEB-445-READABILITY] Dashboard text spacing, enlargement and keyboard catalog | in progress — final installed CI pending |
```

## 2. `docs/SYNC.md` — session-log row

```text
| 2026-09-07 | #445 dashboard readability: real reference-project discovery/capture journeys now exercise spacing and mounted text enlargement, light/dark and narrow/desktop layouts. Sidebar, button, run/header/activity reflow and keyboard catalog fixes are under multi-engine acceptance. Final installed CI and retained proof pending; #402 remains open. |
```

## 3. `CHANGELOG.md` — proposed `Fixed` entry

- Dashboard readability (#445): navigation and text buttons grow with text; run headings, breadcrumbs and activity rows wrap; the model catalog supports keyboard scrolling. Real-app text-spacing/enlargement tests retain numeric checks and masked evidence, including a deliberately clipped control guard. Installed acceptance is pending.

## 4. `VERSION` bump required?

No independent slice bump. Preserve the coordinated 0.0.200 web-product version;
all version manifests remain unchanged in this worktree.

## 5. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/dashboard-readability.real-world.test.ts`
  uses the real vulnerable-auth reference app, source discovery, capture runner
  and selected Chromium/Firefox/WebKit dashboard engine.
- Local red artifacts and subsequent source proof are being retained under
  `docs/evidence/WEB-445-READABILITY/`; final selection and CI are pending.
- Installed runner includes the five new tests: 23 dashboard tests in 13 files.
- Full repository format must run after the final evidence note is written.
- Native browser zoom, arbitrary input-text clipping, full persona/locale/state
  coverage, incomplete accessibility checks and human release inspection remain gaps.

## 6. Sad paths proved

| Trigger                                | Expected disposition                           | Test                          |
| -------------------------------------- | ---------------------------------------------- | ----------------------------- |
| Deliberately clipped real login button | Contradicted numeric containment; failed audit | Clipped-control guard         |
| Unknown text profile                   | Explicit rejection                             | Clipped-control guard         |
| Incomplete accessibility analysis      | Unverified audit, never silent pass            | Shared dashboard proof helper |
| Picker title truncates                 | Full exact heading required after activation   | All four readability journeys |
| Model catalog overflows vertically     | Keyboard focus and End/Home recovery required  | Enlarged-text journeys        |

These are audit outcomes and expected domain mappings; no LLM assigns `verified`.
