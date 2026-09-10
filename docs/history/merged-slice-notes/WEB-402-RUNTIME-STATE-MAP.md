# WEB-402-RUNTIME-STATE-MAP — staged doc updates (charter §10.2)

Issue: #402 · PR: #<PR> · Disposition: observed (runtime observations are `observed`, never verified claims about the app's full state space)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
(No milestone row — #402 slice; record under the #402 status paragraph.)
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-09 | **#402 (WEB-402-RUNTIME-STATE-MAP) source-to-runtime state mapping DONE.** Source discovery now observes the running app: after building the source inventory, the job visits the discovered GET page routes on the project origin with real Chromium (≤12 routes, networkidle + 750ms settle, bounded timeouts; a short reachability probe makes unreachable origins — deliberate in most tests — record an explicit `runtimeObservationGap` instantly and skip), classifies rendered state markers (visible text, aria-busy) with the SAME documented vocabulary as the source tier (`classifyStateText` — one pattern table, both sides), and persists `runtimeStates` on the run. The pure `runtimeStateMap` fuses those observations with #509's source-declared dimensions into the four-way truth table per route × state: declared-and-observed / declared-unobserved (plain navigation cannot provoke every conditional — never disproof) / observed-undeclared (the dynamic-state class: rendered markers no source declaration accounts for) / unobserved-undeclared. The inventory panel renders a Runtime state mapping block with those cells plus an explicit gap note when observation was skipped. Proven red-first on two real engines: the unmodified REAL reference app (real build; /login error = declared-unobserved, / = neither) and real served pages rendering markers through real scripts observed by the real Chromium observer (post-hydration classification, declared-and-observed vs observed-undeclared cells, instant unreachable-origin gap), plus a real-dashboard journey. The source adapter's static `unobservedDimensions` list is unchanged (it describes the source scan's own limits); the web product now observes runtime states separately wherever a running origin is configured. persona/flag-value/action-result/viewport remain unobserved. Next #402: semantic business-intent synthesis, authenticated state coverage, paid inference, human gate. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### <added|changed|fixed|security|internal>`

```
### Added

- WEB-402-RUNTIME-STATE-MAP source-to-runtime state mapping (#402): source discovery now visits the discovered page routes on the running app with real Chromium and records which loading/error/empty state markers actually render (shared vocabulary with the source tier), and the inventory panel maps them onto the source-declared dimensions — declared-and-observed, declared-unobserved (plain navigation cannot provoke every conditional), observed-undeclared (rendered markers no source declaration accounts for) and unobserved-undeclared — with line-anchored source evidence and an explicit gap note when the origin is unreachable. Runtime observations are plain-navigation observations, never claims about the app's full state space.
```

## 4. `VERSION` bump required?

no (integrator folds; user-observable capability — candidate bump at fold time, integrator's call)

## 5. Evidence pointers

- Real-app proof: `apps/web/src/__tests__/runtime-state-map.real-world.test.ts` — the unmodified reference app (real build via the testkit): real discovery observes runtime states; `/login` error = declared-unobserved (the real ternary never renders on plain navigation); `/` = unobserved-undeclared.
- Real-observer proof: same file — real HTTP servers whose pages render markers through real scripts, observed by the real Chromium observer (post-hydration classification; declared-and-observed vs observed-undeclared cells against pinned coverage; unreachable origin records the explicit gap instantly).
- UI proof: same file — real Chromium through the real dashboard renders the Runtime state mapping block (per-route cells on a real served origin) with the plain-navigation honesty wording; the gap note renders when observation is skipped.
- Unit proof: `apps/web/src/__tests__/runtime-state-map.test.ts` — the full four-way truth table and the shared classifier.
- Artifacts: `docs/evidence/WEB-402-RUNTIME-STATE-MAP/{red,green}.txt` (including the Turbopack-workspace finding that re-scoped the proof, and the three disclosed harness corrections).
- Gates: typecheck ☑ (root + packages + web) · lint ☑ · format ☑ full repo · test ☑ (7/7 new lanes; workspace/campaigns/config-omissions/route-coverage 18/18 regression) · license gate — CI `package` job.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                            | Expected disposition                                                                       | Test                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------- |
| unreachable origin (http://127.0.0.1:1)            | explicit `runtimeObservationGap: origin-unreachable`, no Chromium launch, instant          | `runtime-state-map.real-world.test.ts` |
| declared state that plain navigation never renders | `declared-unobserved` — omission signal, never disproof                                    | real-app test (`/login` error)         |
| rendered marker no source declaration accounts for | `observed-undeclared` — the dynamic-state class                                            | mapping test + UI journey              |
| observation crash/timeout mid-pass                 | `gap: observation-failed` (browser closed, run continues)                                  | implementation guard                   |
| unknown persisted dimension strings                | filtered to the known vocabulary inside `runtimeStateMap`                                  | type widening + filter                 |
| route absent from the source inventory             | still mapped (method defaults GET; all cells observed-undeclared or unobserved-undeclared) | unit truth table (`/runtime-only`)     |
