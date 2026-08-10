# M2-SERVICE-WORKERS — staged doc updates (charter §10.2)

Issue: #108 · PR: #113 · Disposition: observed (real containment and diagnostic proof)

## 1. `docs/SYNC.md` — tracker/current-state update

There is no existing M2 tracker row. Record #108 as addressed: Crawlee discovery keeps
its persistent context (`useIncognitoPages: false`) and sets
`serviceWorkers: 'block'`, preventing worker-owned traffic from bypassing page routes.
This branch was rebased onto `9e59e2f`, after #111, #115, and #112 merged.

## 2. `docs/SYNC.md` — session-log row

```text
| 2026-08-10 | **#108 (M2-SERVICE-WORKERS) Service Worker containment prepared.** Crawlee discovery blocks Service Worker registration while retaining its persistent context. A real Chromium fixture proves that an allowed hostile worker reaches same-origin POST and cross-origin sinks; discovery reaches neither sink and emits blocked `ARXIC-SURFACE-001` and `ARXIC-SURFACE-008` diagnostics for both page-owned fallback attempts. Rebased over the merged #111, #115, and #112 changes. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### Security`

```text
- M2-SERVICE-WORKERS (#108): block Service Worker registration in Crawlee discovery so cross-origin and non-safe-method requests remain visible to interception and produce `ARXIC-SURFACE-001`/`ARXIC-SURFACE-008` diagnostics. Real Chromium proves both prohibited requests are denied and diagnosed.
```

## 4. `VERSION` bump required?

yes → patch bump, because this is a user-observable security fix; the integrator must
update `VERSION` and root `package.json` together.

## 5. Evidence pointers

- Real-world proof: `packages/crawlee-adapter/src/__tests__/service-workers.real-world.test.ts`
  runs real Crawlee/Playwright/Chromium against live same-origin mutation and
  cross-origin sinks and asserts both blocked diagnostics.
- Artifacts: `docs/evidence/M2-SERVICE-WORKERS/service-worker-registration-blocked.png`
  is supplementary. The previously retained raw trace was removed under the
  no-raw-trace-retention policy; no trace or trace sidecar is retained or generated.
- Composition: rebased onto `origin/main` at `9e59e2f` with #111 trace sanitization,
  #115 screenshot privacy, and #112 bundle-integrity work already merged.
- Gates: affected real-Chromium suite 2 files / 4 tests PASS; full suite 92 files /
  762 tests PASS; root and recursive typechecks, lint, format check, and license gate
  PASS (757 packages scanned, 0 rejected).

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                     | Expected disposition                                                                          | Test                                                       |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Hostile page activates a Service Worker and attempts cross-origin GET plus same-origin POST | Allowed-control run reaches both sinks, proving the exploit path                              | `service-workers.real-world.test.ts` allowed-worker test   |
| Same fixture runs through discovery                                                         | Worker script and both sinks remain untouched; result stays `observed`                        | `service-workers.real-world.test.ts` containment test      |
| Blocked registration falls back to page-owned prohibited requests                           | Both requests are denied with blocked `ARXIC-SURFACE-001` and `ARXIC-SURFACE-008` diagnostics | `service-workers.real-world.test.ts` diagnostic assertions |
| Discovery accidentally changes to per-page incognito contexts                               | Cross-page cookie/session regression fails                                                    | `sad-paths.test.ts` persistent-context test                |
