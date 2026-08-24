# FIX-307-verifier-network-attribution — staged doc updates (charter §10.2)

Issue: #307 · Status: **contradicted by round-6 field evidence — per-request attribution fix in flight (F-E8)** · Disposition: observed

> **Round-6 amendment (2026-08-24, `directus-dg12-run6`):** the time-window rule recorded below was CONTRADICTED by the real target — directus's boot probe (`/auth/refresh` → 400 + console error) fires AFTER the first goto, inside the armed window, so stage-10 still blocked. The code that landed via #310 helps only the pre-navigation case. AC-4 failed; the corrected rule (per REQUEST: a goto attributes only its document request; a click/submit attributes requests sent during the awaited action window; boot probes never gate; zero-window armed suites block fail-closed) is tracked as F-E8 on #307 and lands as a follow-up slice.

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #307 | [FIX-307-verifier-network-attribution] receipt events arm at the first workflow navigation — app-autonomous boot probes no longer fail the network gate (F-E6) | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-24 | **#307 (FIX-307-verifier-network-attribution) verifier network attribution DONE.** The transition-receipt runtime records events only once armed; the generated spec arms at its FIRST workflow-initiated navigation (armReceiptCapture right before the entry goto, exactly once). App-autonomous boot probes (directus fires /auth/refresh -> 400 + a console error on every unauthenticated load, BEFORE any workflow action) no longer violate the network policy — measured on the campaign (directus-dg12-run5 stage-10: VERIFY-BLOCKED-NETWORK on exactly that 400). Workflow-caused failures still gate: the network-gate real-world test (404 + console-error through an armed goto) blocks as before, and the new app-autonomous complement (boot probes before the first navigation) passes clean. Honest disclosure: the code landed inside PR #310's fix rounds (commit 2e58aaf accidentally bundled the runtime arming; 9643439 landed the matching test updates; the spec-generator arming + compiler contract test followed) — all disclosed on that PR at the time. **Next: DG-12 round 6 under #256 (with #308 merged).** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-307 verifier network attribution (#307): transition-receipt events are attributed to the workflow, not the browser-context lifetime — recording arms at the first workflow-initiated navigation (armReceiptCapture before the entry goto). App-autonomous boot probes (an SPA's own unauthenticated session refresh -> 4xx + console error, e.g. directus /auth/refresh) no longer fail ARXIC-VERIFY-BLOCKED-NETWORK for every login-through workflow; failures after the workflow takes control still gate unchanged.
```

## 4. `VERSION` bump required?

no — generated-suite + runtime-internal semantics; the receipt schema is unchanged (armed-filtering happens before events are recorded).

## 5. Evidence pointers

- Runtime: `packages/playwright-compiler/src/transition-receipt-runtime.ts` — `state.armed` gate on all four listeners (requestfailed / http-response / console-error / pageerror) + `armReceiptCapture(page)`.
- Spec: `packages/playwright-compiler/src/spec-generator.ts` — `armReceiptCapture(page)` emitted exactly once, immediately before the FIRST transition's goto.
- Contract test: `packages/playwright-compiler/src/index.test.ts` `'#307 receipt events arm at the first workflow navigation'` (red on pre-fix sources — proven by restoring only the test file — green after).
- Workflow-caused still gates: `packages/verifier/src/real-world.test.ts` `'records real Chromium HTTP and console errors and applies the default network gate'` (armed 404 + console-error → blocked).
- App-autonomous does NOT gate: same file `'#307 app-autonomous boot errors before the first navigation do not gate'` (script-tag boot probe to a 404 route + console.error BEFORE arming → receipt clean; runs against both fixture apps).
- Field evidence of the defect: `docs/evidence/DG-12/directus/runs/directus-dg12-run5/` stage-10 diagnostics (`VERIFY-BLOCKED-NETWORK: run 1: http-response 400 …/auth/refresh, console-error`) on `issue/256`.
- Gates on the final state: typecheck ☑ · lint ☑ · format ☑ · verifier 102/102 + playwright-compiler 71/71 (PR #310's green CI covers the merged state).

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                           | Expected disposition                                                                           | Test                                                                                 |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 4xx + console error from an armed workflow goto (workflow-caused) | blocked, network gate fires (unchanged strictness)                                             | `records real Chromium HTTP and console errors and applies the default network gate` |
| app-autonomous 4xx + console error before the first navigation    | NOT recorded; receipt clean; verification not gated (observed on both fixture apps)            | `#307 app-autonomous boot errors before the first navigation do not gate`            |
| arming before any listener install                                | fail-closed `ARXIC-TRANSITION-RECEIPT-UNAVAILABLE` (same as receipt recording without install) | runtime's shared guard clause                                                        |

## 7. Not done / known-weak spots

- Attribution is COARSE: arming is one-way at the first navigation — a probe the app fires AFTER the workflow starts (e.g. a polling endpoint returning 4xx mid-run) is recorded and gates. That is the conservative direction (fail-closed); a finer per-request attribution (document-initiator classification) is future work if a real target needs it.
- The app-autonomous proof uses the fixture apps' origins (a script-tag probe to a 404 route), not a real directus instance — the directus shape is evidenced by the run-5 field artifacts; round 6 provides the live proof.
- AC-4's full statement (a directus campaign round passes stage-10's network gate and reaches real assertion results) executes as DG-12 round 6 under #256.
