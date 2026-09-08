# WEB-402-PERSONA-VARIANTS-1B — staged doc updates (charter §10.2)

Issue: #402 · PR: (this branch `persona-variants-1b-402`) · Disposition: observed implementation, local green (typecheck/lint/format + the suites below); CI on the PR head is the remaining gate — an LLM cannot assign `verified`.

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

(none — #402 is tracked as one umbrella issue; fold into the "Latest merged work" paragraph instead)

```
… and persona execution variants for one-shot campaigns (#491, `b9a4f5d1` — …) and recurring persona variants with variant-aware rebind (#491b slice, this PR — both slice-1 fallbacks removed: recurring (cron) × variants is accepted at enqueue, each scheduled fire repeats the full default+variants fan-out on a fresh fired campaign record that itself carries `variants` (load-bearing: drain resolves fired variant credentials through the fired record) with per-fire `runId`/`runIds` attribution, fire/rebind capacity defers rows × (1 + variants) against the 20-active cap without dropping the due slot, and a drifted variant campaign now rebinds by row identity with the same variant fan-out and row-level survivor/dropped counts; an unset fired-variant secret still blocks only that fired variant run) are merged …
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-09 (5) | **#402 (WEB-402-PERSONA-VARIANTS-1B) recurring persona variants + variant-aware rebind DONE.** Removed both slice-1 fallbacks in `apps/web/src/workbench.ts`: the cron × variants 400 at enqueue, and the variant → `campaign.rebind-failed` guards in `startRebindOrStop`/`rebindCampaign`. The recurring fire path fans each selected row out into a default run plus one per variant (declared order, `workflowScope.variantKey`), stamps `variants` on the fired record (drain credential resolution depends on it), strips BOTH stale `runId`/`runIds` from carried-over rows, and defers (never drops) when `active + rows × (1 + variants) > 20`. Rebind mirrors the same fan-out on fresh inventory rows with row-level `rebound` counts. Proven red-first with 4 new real journeys on a real reference-auth-app checkout (fan-out/attribution, defer-not-drop via 18 real fillers + real cancels, real-git-drift rebind, fired-record unset-secret) plus regressions: persona-variants 9/9, drift-rebind 4/4, drift-revalidate 3/3, recurrence 3/3, campaign-ui 1/1, workspace 7/7. Deliberate slice-1 inversions disclosed: the cron×variants→400 matrix case and the rebind-guard journey in `persona-variants.real-world.test.ts` were replaced by the new accepting/rebind journeys. **M? 4/4 new.** Next: state/flag variant kinds. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- WEB-402-PERSONA-VARIANTS-1B recurring persona variants with variant-aware rebind (#402): recurring (cron) campaigns accept persona variants — every scheduled fire repeats the full default+variants fan-out on a fresh fired record that carries the variants (so drain resolves fired variant credentials) with strictly per-fire run attribution, fire and rebind capacity defer rows × (1 + variants) without dropping the due slot, drifted variant campaigns rebind by row identity with the variant fan-out and row-level survivor/dropped counts, and an unset fired-variant secret blocks only that fired variant run; proven with real fire/defer/drift-rebind/unset-secret journeys on a real reference-auth-app checkout.
```

## 4. VERSION bump required?

<yes → 0.0.302, integrator folds: user-observable capability change per RELEASES.md>

## 5. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/persona-variants-recurring.real-world.test.ts` — real `Workbench.open` on a real reference-auth-app checkout (packages/real-world-testkit fixture repo), real discovery, explicit `wb.tick`/`guardDueCampaigns` drives, real git drift commit, real queue fillers cancelled through the real API.
- Artifacts: `docs/evidence/WEB-402-PERSONA-VARIANTS-1B/red.txt` (verbatim 4/4 red against the pre-change fallbacks), `docs/evidence/WEB-402-PERSONA-VARIANTS-1B/green.txt` (two consecutive 4/4 green runs).
- Gates: typecheck ☑ (apps/web `tsc --noEmit`) · lint ☑ (primary-root `pnpm lint`) · format ☑ (`pnpm format:check`, last line pasted on the PR) · test ☑ (4/4 new + 27 regressions listed in §2) · license gate ☐ (CI-only)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                        | Expected disposition                                                                                                                 | Test                                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Queue cannot fit the fire's fan-out (18 active + 3 slots > 20) | deferred — slot stays due, nothing enqueued, full fire lands after capacity frees (real cancels)                                     | `persona-variants-recurring…` "defers a recurring variant fire…"                |
| Fired variant's `ARXIC_SECRET_` unset at drain                 | only that fired variant run blocks on the secret message; fired default + resolved variant fail at the distinct model stage          | `persona-variants-recurring…` "blocks a fired variant run on its unset secret…" |
| Real git drift on a recurring variant campaign at a due slot   | rebind starts (audit `campaign.rebind-started`), lands with `variants`, row-level counts, 3-run fan-out, NO `campaign.rebind-failed` | `persona-variants-recurring…` "rebinds a drifted recurring variant campaign…"   |
| Fired record built from source rows carrying stale `runIds`    | both ids stripped; fired rows carry only this fire's runs                                                                            | `persona-variants-recurring…` "fires a recurring variant campaign…"             |

Known gaps: fired-record attribution is per-fire only (later fires do not chain `runIds`); rebind outcome counts stay row-level (not run-level); the slice-1 400 and rebind-guard journeys in `persona-variants.real-world.test.ts` were deliberately inverted/removed (disclosed above and on the PR); state/flag variant kinds remain future work.
