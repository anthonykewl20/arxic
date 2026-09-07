# WEB-454-DENSITY — native renderer and dashboard recovery follow-up

Source: `923794b3c3d33263f6deb0f813cd5aee0ed774b0` plus the source files bound by `followup/manifest.json`. This is local, scoped proof; exact-head CI and installed distribution acceptance are pending. The earlier [partial record](./summary.md) and its failing pixels remain unchanged as historical evidence.

## Findings and resulting behavior

The Chromium headless shell produced two distinct text rasters across sixteen fresh native 3× captures of the actual Express reference app. Both variants could satisfy within-page stability. A larger plain-capture control disproved the earlier collector-only hypothesis; computed geometry and the reported Arimo platform font were identical. Full Chromium headless produced one hash across sixteen comparable measured captures (and thirty-two earlier plain/measured probes). Native Chromium 2×/3× cells now use `channel: 'chromium'` and include `renderer: 'chromium-full-headless'` in baseline identity. Existing 1× identity and renderer remain unchanged. Missing full Chromium is a blocked environment, with no silent fallback. This is the documented [Playwright full-headless channel](https://playwright.dev/docs/browsers#chromium-new-headless-mode).

The original nine-cell baseline/repeat/intentional-2×-regression assertion now passes in two fresh runs. No pixel threshold, fixture font, comparison assertion, or image bound was relaxed. The retained second run includes all three phases and native PNG dimensions; scene measurements remain CSS pixels. The portable diagnostic can be repeated with a new output directory:

```sh
pnpm --filter vulnerable-auth-app exec tsx ../../apps/web/src/__tests__/native-renderer.probe.ts /tmp/arxic-native-renderer-new
```

A valid native 3× capture above the model's four-megapixel bound previously produced a misleading integrity error. The shared image validator now returns a typed dimension refusal; the review action offers a smaller viewport or lower density. The model image limit remains unchanged. Real light/dark dashboard journeys check the visible recovery message, retained form input and re-enabled submit control. This rejection occurs before inference; no paid-model result is claimed.

Expanding authenticated coverage from six to eighteen browser/theme/density cells exposed the actual Next.js reference app's ten-login-per-minute email limit. Two Firefox dark cells were blocked. The runner now performs one real GUI sign-in per browser family and keeps that result only in memory for the current run. All eighteen authenticated captures pass; a subsequent run with incorrect credentials produces eighteen blocked cells and zero captures. The fixture rate limit was not changed. Three login actions and fifteen explicit reuse actions are asserted. This covers authenticated captures, not eighteen independent login-UI journeys.

## Checks and retained artifacts

| Check | Local result | Evidence |
| --- | --- | --- |
| Native baseline, unchanged repeat and 2× regression | Pass in two fresh nine-environment runs | `followup/native-engine/`, `native-engine-result.txt` |
| Shell/full diagnostic | Shell: two hashes; full: one across sixteen each | `followup/renderer-probe/summary.json` and masked PNGs |
| Missing credentials, eighteen authenticated captures, fresh bad-credential refusal | Pass | `followup/authenticated/`, `authenticated-result.txt` |
| Native image-size refusal and shared validator | Seven tests pass | `followup/review-size-result.txt` |
| Dashboard density, review and existing matrix journeys | Pass: 21 tests / 5 files, 141.32 s; Vitest exit 0 | `followup/dashboard/`, `followup/review/`, `followup/matrix/` |
| Root/package typechecks and lint | Exit 0 | Re-run commands: `pnpm typecheck`, `pnpm typecheck:packages`, `pnpm lint` |

The first combined dashboard command printed twenty-one passing tests but its shell session returned 143. That command is not accepted as a green gate; a fresh invocation passed all twenty-one tests and recorded Vitest exit 0 separately (`followup/dashboard-exit.txt`). The prior session signal is not attributed to a product defect without evidence. No assertion was altered in response.

Named PNGs are masked at capture time with adjacent privacy records. Timelines are sanitized with adjacent provenance; no raw trace ZIP, credentials or storage state is retained. Agent inspection includes the three browsers' authenticated dark 3× captures and dashboard review-refusal/mobile element-picking states. Magenta regions are deliberate privacy masks. The reference app does not implement a dark theme; a dark browser preference is not proof that it does. Agent viewing is not independent human release inspection.

## Coverage boundary

This slice adds density selection, responsive gallery filtering, measured element picking, explicit renderer identity and actionable errors. It does not establish exhaustive discovery, all states/roles/locales, zoom/forced-colors coverage, paid-model accuracy or a complete heuristic audit. #402, #447 and #448 remain separate open work. Required exact-head CI, installed three-browser proof and the integration/version ritual must finish before this slice is called complete. Human screenshot release sign-off remains outstanding.
