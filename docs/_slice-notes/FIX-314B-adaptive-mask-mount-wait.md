# FIX-314B-adaptive-mask-mount-wait — slice note

Issue: #314 (follow-up) · Status: fixed on this branch, awaiting CI + AC-4 round-10 field proof · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #314 | [FIX-314B-adaptive-mask-mount-wait] the adaptive mask probe waits (bounded, locator.waitFor) for ANY landmark to attach before concluding nothing is maskable — SPA mount races (directus run-2 shape) capture instead of failing | ☑ done (code; AC-4 round 10 pending) |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-25 | **#314 follow-up (FIX-314B-adaptive-mask-mount-wait) bounded landmark wait.** Round-9 field evidence: verification run 1 on the real directus login passed END-TO-END (formScope, fills, URL, checkpoint screenshot with the adaptive mask) but run 2 failed closed on nothing-maskable — a mount race, probed live 3/3: the directus SPA renders ZERO landmark elements immediately after goto (the Vue app mounts the login form milliseconds after the load event). Fix: \`adaptiveLandmarkMasks\` first waits (bounded 5s, \`locator.waitFor({ state: 'attached' })\` — an ALLOWED API; the forbidden list names only waitForTimeout/waitForLoadState/page.evaluate) for ANY landmark selector (\`main, article, form, aside, nav, header, footer\`) to attach, then probes tags as before. Waiting for something to MASK is capture stabilization, never a privacy loosening; a page that never mounts a landmark still fails closed after the bound (pinned by test). Red-first: a late-mounting page (form injected at 400ms — first test draft had a real bug of its own: an unescaped quote made the page script a syntax error, silently never mounting; simplified to a bare form) failed pre-fix with the exact run-2 stage-10 error, passes post-fix with \`maskAdaptation: ['form']\`. **Next: DG-12 round 10 under #256 (AC-4).** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-314B adaptive mask mount wait (#314): the adaptive screenshot-mask probe now waits (bounded) for any landmark element to attach before concluding a page has nothing maskable — SPA shells that mount their landmark set milliseconds after the load event (the directus admin login shape) capture instead of racing to a fail-closed miss; pages that never mount a landmark still fail closed after the bound.
```

## 4. `VERSION` bump required?

no — bounded capture stabilization inside the #314 adaptation path; no contract or schema change.

## 5. Evidence pointers

- Defect evidence: `docs/evidence/DG-12/directus/runs/directus-dg12-run9/` stage-10 — run 1 PASSED (first-ever full directus verification pass incl. checkpoint screenshot); run 2 `ARXIC-SCREENSHOT-CAPTURE-FAILED: declared mask locator inventory is missing or exceeds its bound` + downstream `SCREENSHOT-INVENTORY-INVALID`; live probe (3/3): `locator('main, article, form, aside, nav, header, footer').count() === 0` immediately after goto, form present milliseconds later.
- Fix: `packages/playwright-screenshot-privacy/src/standalone-runtime.ts` — `ADAPTIVE_MASK_WAIT_MS = 5_000`; `adaptiveLandmarkMasks` awaits `anyLandmark.first().waitFor({ state: 'attached', timeout })` (timeout swallowed → probe proceeds → empty set still fails closed).
- Red-first tests: `'#314 waits for a late-mounting landmark before adapting masks'` (red pre-fix; green post-fix ~400ms with `maskAdaptation: ['form']`); `'#314 still fails closed when no landmark ever mounts'` (green pin through the full 5s bound, vitest timeout raised to 15s for the wait-bearing tests — disclosed); pre-existing `blocks a masked-page capture when a declared semantic mask resolves to nothing` likewise raised to 15s (it now exercises the full bounded wait).
- Gates: screenshot-privacy + verifier + compiler + orchestrator-langgraph + cli (real-Docker worker e2e on a REBUILT image — the stale-cached-image artifact documented in FIX-314 strikes on every runtime-source change) + m0-pipeline + bundle-promoter + intent-proposal-spike = 79 files / 779 tests passed; typecheck/lint clean; `format:check` after this note: `All matched files use Prettier code style!`

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                         | Expected disposition                                                                        | Test                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| landmark mounts late (SPA race, directus shape) | wait catches it; capture adapts; receipt discloses roles (observed, real Chromium)          | `#314 waits for a late-mounting landmark…`             |
| no landmark ever mounts                         | bounded wait elapses; capture fails closed; no artifacts retained (observed, real Chromium) | `#314 still fails closed when no landmark ever mounts` |
| landmark-free page + declared mask miss         | same fail-closed through the full bound (observed, real Chromium)                           | `blocks a masked-page capture…`                        |
| declared masks resolve                          | no wait, no adaptation recorded (observed, real Chromium)                                   | `#314 uses declared masks unchanged…`                  |

## 7. Not done / known-weak spots

- AC-4 (a full directus campaign round passing stage-10 with 2/2 clean runs) executes as round 10 under #256 after this merges.
- The 5s bound is a constant, not policy-driven; a pathologically slow SPA (>5s to mount any landmark) still fails closed — correct but worth revisiting if a real target ever hits it.
- Local dev only (repeated from FIX-314 because it bit again during this slice): a stale cached `arxic-worker:dev` image fails the worker e2e on ANY runtime-source change; rebuild before judging the suite.
