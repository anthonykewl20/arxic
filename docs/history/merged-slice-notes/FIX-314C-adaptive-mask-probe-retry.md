# FIX-314C-adaptive-mask-probe-retry — slice note

Issue: #314 (second follow-up) · Status: fixed on this branch, awaiting CI + AC-4 round-11 field proof · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #314 | [FIX-314C-adaptive-mask-probe-retry] the adaptive mask probe re-probes within its bounded budget — a landmark that unmounts mid-capture (transient SPA empty window, directus round-10 shape) no longer defeats the wait | ☑ done (code; AC-4 round 11 pending) |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-25 | **#314 second follow-up (FIX-314C-adaptive-mask-probe-retry) probe retry.** Round-10 field evidence: BOTH verification runs failed at the checkpoint screenshot with the mask-inventory error — with the bounded-wait runtime verifiably baked in (fixtures/screenshot-privacy.ts carries the waitFor). Root cause (probed live): after the Sign In click, directus navigates through a TRANSIENT EMPTY WINDOW — the login form unmounts, the body renders nothing (landmarks 0, empty innerText), and the admin app mounts ~500ms later. Wait-then-probe-ONCE loses that race: the wait can resolve on a landmark that unmounts before the per-tag counts run (each roundtrip inflated by suite instrumentation — trace recording), leaving an all-zero probe. Fix: \`adaptiveLandmarkMasks\` becomes a retry loop — probe; if empty, wait (bounded by the REMAINING budget) for any landmark to attach and re-probe; a page that never presents a maskable landmark still fails closed when the budget elapses (empty probe = invalid, caller unchanged). Disclosed semantics: a capture that starts during SPA navigation may mask-and-capture the NEXT mounted state (the asserted URL was already asserted before capture; the mask set adapts to whatever is on the page). Red evidence: the FIELD run itself (2/2 failures with the wait code baked in) — standalone reproduction is timing-dependent (a fast count loop still catches the form; probes of the exact sequence mostly pass), so the local test pins the POST-fix property (vanish-and-remount always captures) rather than a deterministic pre-fix red. **Next: DG-12 round 11 under #256 (AC-4).** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-314C adaptive mask probe retry (#314): the adaptive screenshot-mask probe now re-probes within its bounded budget when its first pass observes an empty landmark set — SPA routes that unmount their landmark mid-navigation (the directus post-login empty window) capture the next mounted state instead of racing to a fail-closed miss; pages that never mount a landmark still fail closed after the bound.
```

## 4. `VERSION` bump required?

no — retry loop inside the existing #314 adaptation path; no contract or schema change.

## 5. Evidence pointers

- Defect evidence: `docs/evidence/DG-12/directus/runs/directus-dg12-run10/` stage-10 — both runs `ARXIC-SCREENSHOT-CAPTURE-FAILED: declared mask locator inventory is missing or exceeds its bound` with the bounded-wait runtime baked in (`fixtures/screenshot-privacy.ts` line 708); live probes (`probe10`): t=0 login form attached (landmarks 1) → t=500ms URL still `/admin/login` but landmarks 0 and body EMPTY → t=1000ms admin content mounted (landmarks 4, `/admin/content`).
- Fix: `packages/playwright-screenshot-privacy/src/standalone-runtime.ts` — per-tag probing extracted to `probeAdaptiveLandmarks()`; `adaptiveLandmarkMasks()` loops probe → if empty wait-for-attach bounded by remaining budget → re-probe, until non-empty or deadline; empty-at-deadline still returns the empty set and the caller fails closed (unchanged error, unchanged bounds).
- Tests: `'#314 re-probes when the initial landmark unmounts mid-capture'` (form removed at 1ms, nav mounted at 600ms — post-fix always captures; DISCLOSED: the pre-fix failure is timing-dependent, so this is a post-fix property pin, not a deterministic red — the red evidence is field run 10); existing late-mount, never-mount, declared-masks-resolve pins unchanged and green.
- Gates: chunked sweep (executor 10-min cap) — screenshot-privacy + compiler + orchestrator-langgraph + m0-pipeline + bundle-promoter + intent-proposal-spike = 56 files / 548 tests; verifier = 6 / 102; cli (real-Docker worker e2e on a REBUILT image) = 17 / 130; total **79 files / 780 tests passed**; typecheck/lint clean; `format:check` after this note: `All matched files use Prettier code style!`

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                             | Expected disposition                                                                           | Test                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| landmark unmounts mid-capture, another mounts later | retry bridges the empty window; capture succeeds with an adapted set (observed, real Chromium) | `#314 re-probes when the initial landmark unmounts mid-capture` |
| landmark mounts late (SPA race, round-9 shape)      | wait catches it; capture adapts (observed, real Chromium)                                      | `#314 waits for a late-mounting landmark…`                      |
| no landmark ever mounts                             | budget elapses; capture fails closed; no artifacts retained (observed, real Chromium)          | `#314 still fails closed when no landmark ever mounts`          |
| declared masks resolve                              | no wait, no adaptation recorded (observed, real Chromium)                                      | `#314 uses declared masks unchanged…`                           |

## 7. Not done / known-weak spots

- AC-4 (full directus round passing stage-10 with 2/2 clean runs) executes as round 11 under #256 after this merges — three campaign rounds have now each exposed the NEXT seam on this path (locator binding → mask anchor → mount race → probe race); round 11 is the proof, not a formality.
- The captured page during SPA navigation may be the NEXT mounted state (post-assertion URL drift is not re-checked at capture time); privacy-compliant (masked superset) and disclosed here, but if the contract should bind capture to the asserted URL that is a separate, deliberate change.
- The 5s budget stays a constant (not policy-driven).
- Local dev only: stale cached `arxic-worker:dev` image fails the worker e2e on ANY runtime-source change (rebuilt here before the sweep); CI builds fresh.
