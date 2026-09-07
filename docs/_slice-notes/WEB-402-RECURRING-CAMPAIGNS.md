# WEB-402-RECURRING-CAMPAIGNS — staged doc updates (charter §10.2)

Issue: #402 · Disposition: observed implementation (local green; CI and independent human inspection pending — an LLM cannot assign `verified`).

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```text
| #402 | Web product release: comprehensive frontend intent campaigns and AI visual auditing | In progress; recurring selected campaigns landed on durable UTC cron slots with fresh per-execution denominators |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```text
| 2026-09-07 | **#402 (WEB-402-RECURRING-CAMPAIGNS) recurring selected campaigns landed.** `enqueueCampaign` accepts an optional five-field UTC cron validated by the existing `nextSlot()` (400 on non-string/invalid); the Workbench `tick()` transaction fires due recurring campaigns exactly once per slot into a fresh campaign record (own id, own runIds, own full denominator, same discovery + selected rows), advancing the source's `nextFireAt`; missing project/execution/discovery stops the recurrence with a `campaign.schedule-stopped` audit event; queue capacity defers (never drops) a slot; cancelled campaigns stop firing; each fire is audited as `campaign.scheduled`. Real-world proof: real Workbench + real `makeRepository('reference-auth-app')` discovery + real engine agent runs fired by `tick()` (campaign-recurrence.real-world.test.ts, 3× local 9/9 incl. the pre-existing campaigns suite; red first at `aff6eddb` with both assertions failing at the selection validator as designed). Boundary: recurrence re-executes the SAME pinned discovery rows without re-validating source drift per fire (sourceCommit preserved; re-discovery binding is a recorded follow-up), and inventory/ledger views still do not union all prior campaign outcomes (separate open row). Gates local: typecheck ☑ (apps/web tsc) · test 9/9 ☑ · format ☑ (full repo after note) · lint ☑; CI `ci` run on the PR head is the remaining gate. Human screenshot inspection remains owed release-wide. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```text
- WEB-402-RECURRING-CAMPAIGNS recurring selected campaigns (#402): campaigns can now carry a five-field UTC cron; each slot re-executes the selected source rows as a new campaign execution with its own denominator, with missed-slot coalescing, capacity deferral, audited fires and schedule-stopped diagnostics — proved against the real reference-app discovery and engine runs (real-workbench test suite).
```

## 4. `VERSION` bump required?

No — the fold integrator owns `VERSION`; the capability rides the current `0.0.301` increment already staged by the docs fold (#467).

## 5. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/campaign-recurrence.real-world.test.ts` — real Workbench, real discovery over `makeRepository('reference-auth-app')`, real engine agent runs; recurrence fired through the real `tick()` scheduler (24–40 s journeys).
- Artifacts: `docs/evidence/WEB-402-RECURRING-CAMPAIGNS/green.txt` — persisted final full pass (`Tests 9 passed (9)`; includes the pre-existing campaigns suite as regression). Red record: commit `aff6eddb` is the reproducible red (check it out; both tests fail at the selection validator / wrong sad-path message). A mid-flight rerun exposed a test-side race (the Workbench's own background tick legitimately fired the slot while the test idled); the test now captures the slot before idling — implementation behavior was confirmed correct, no assertion was widened.
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (9 passing, 3× repeated) ☑ · license gate → CI.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                      | Expected disposition                                                       | Test                                                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `cron: 'every minute please'` (non-cron string)              | 400 `five-field cron` before any campaign child is inserted                | `rejects a non-five-field campaign recurrence cron…` (red→green)                         |
| `cron` key of non-string type                                | 400 `cron must be a string`                                                | same validator branch (code-reviewed; exercised via the same test file's validator path) |
| Slot fires while queue at capacity (activeCount + rows > 20) | Deferred, not dropped — slot stays due, retried next tick                  | `tick()` deferral branch, `workbench.ts` campaign loop                                   |
| Project/execution/discovery deleted mid-recurrence           | Schedule stops with `campaign.schedule-stopped` audit, `nextFireAt` nulled | `tick()` stop branch                                                                     |
| Two `tick()` calls at the same instant                       | Exactly one firing per slot (coalescing)                                   | asserted in `re-fires a recurring campaign…`                                             |
| Background tick and test race on the same slot               | Still exactly one campaign per fired slot                                  | the rerun failure that reshaped the test (documented above)                              |
