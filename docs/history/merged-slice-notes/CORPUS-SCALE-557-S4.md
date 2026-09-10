# CORPUS-SCALE-557-S4 — staged doc updates (charter §10.2)

Issue: #557 · PR: _this PR_ · Disposition: observed (slice 4 — the 11th family captured at the full width grid; register C3 carries the 11-family accounting; the ≥1,000-row bar stays open with residual ≥552)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #557 | [CORPUS-SCALE-557] corpus scale: 11 families toward the 1,000-region bar | ◐ in progress |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-07 | **#557 (CORPUS-SCALE-557-S4) slice 4: 11-family registry accounting — material-dashboard at the full width grid.** Real Chromium through `cli.ts corpus material-dashboard,sb-admin-2 360,640,1024,1280` over all 14 variants: 112 planned → 9 reason-carrying skips → 103 scored rows (md 47 + sb-admin-2 56/56, 317 non-null labels; md alone 210). Skip taxonomy exactly as slice 3 predicted: missing-element `unstable-case` ×4 (one per width — the `my-auto`-centered card moves every input box when the control is removed) and remote-subresource `page.goto` timeouts ×5 (the only registry family with remote assets). Register C3 updated: registry totals across the two labeled runs are 532 planned → 84 skips → **448 scored rows across 11 families, 1,988 non-null oracle labels** (additive observations, not one plan); residual under the rows unit **≥552**. Evidence `docs/evidence/VISUAL-SLM/corpus-scale-2026-09-10-s4/` (sanitized, sidecars parse, leak scan clean). Dispositions: observed; `noTeacherCalls: true`; promotion stays `blocked-experimental-model`. **M0 gates green.** Next: #557 — further registry growth (~11+ families to the bar under the rows unit) or the owner's C3 unit ruling; both recorded in the register. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### changed`

```
- CORPUS-SCALE-557-S4 11-family registry accounting (refs #557): the
  material-dashboard family was captured at the full width grid (360/640/1024/1280
  × 14 variants) through the real pipeline with real Chromium — 112 planned →
  9 reason-carrying skips → 103 scored rows with sb-admin-2 scoring a perfect
  56/56 in the same run. Register C3 now records the 11-family totals (532
  planned → 84 skips → 448 scored rows, 1,988 non-null oracle labels across two
  labeled runs) and the honest residual (≥552 rows) under the unchanged rows-unit
  reading; the family's two genuine limitations (centered-card missing-element
  instability, remote-subresource navigation timeouts) are recorded as reasons,
  not fabricated rows. Evidence retained sanitized under
  `docs/evidence/VISUAL-SLM/corpus-scale-2026-09-10-s4/`.
- CORPUS-SCALE-557-S4 CI boot tolerance for the dashboard-progress interruption
  test (refs #557): two consecutive CI runs of this docs-only PR failed
  `scripts/dashboard-progress.test.mjs > flushes case-start evidence before a
  real running test process is interrupted` — the nested vitest child printed
  `run-start` at 9ms and then stalled in worker/file-collection boot past the
  60s poll bound while the same CI shard ran concurrent real-browser suites
  (local boots ~220ms, six of six; the test already documented a >10s CI boot,
  run 34355455688). Investigation cleared the reporter (vitest-4-compatible)
  and the fixture signature (positional timeout fires case-start when booted);
  the bound was the defect. Poll 60s→180s, fixture hang 120s→360s, outer cap
  90s→240s — moved together so the interrupt still always lands before any
  timeout result can exist. The tested property is UNCHANGED (case-start
  evidence exists and no case-result precedes the interrupt); only the
  cold-start tolerance widened, disclosed here per the no-silent-loosening
  rule. Test green locally after the change (4/4).
```

## 4. `VERSION` bump required?

no — corpus/evidence bookkeeping, not user-observable product behavior.

## 5. Evidence pointers

- Real-world proof: `cli.ts corpus material-dashboard,sb-admin-2 360,640,1024,1280`
  (run dir local-only, `/tmp/corpus-s4-WWwL`) — real Chromium; exit 0; summary
  JSON rows 103, skipped 9, parityMaximumError 3.8e-7, promotion
  `blocked-experimental-model`.
- Retained sanitized: `docs/evidence/VISUAL-SLM/corpus-scale-2026-09-10-s4/` —
  corpus-v2.json + corpus-report.json + 3 representative material-dashboard cases
  (640-clean, 1024-clip-full scored; before/current PNGs with privacy sidecars,
  sanitized timelines); 4/4 sidecars parse; credential-shaped-content scan clean.
- Register: `docs/release-gates/undischarged-gates.md` C3 — slice-4 bullet with
  the 11-family totals and the residual; the slice-2 "registry maximum" sentence
  re-scoped to the 10-family config it described.
- CI-hardening evidence: PR #564 failed `test (1/4)` twice on run 34444256422
  (and its failed-only rerun) at `scripts/dashboard-progress.test.mjs:132` —
  `expected '{"event":"run-start","elapsedMs":9}\n'` to contain `case-start`
  after 60s; controlled local trials isolated boot starvation (reporter and
  fixture signature exonerated; 6/6 local boots ~220ms). Bound widening verified
  locally: `vitest run scripts/dashboard-progress.test.mjs --no-file-parallelism`
  → 4 passed (interruption test 6073ms).
- Gates: typecheck ☑ · lint ☑ · format ☑ (full repo, after this note) · test
  (`scripts/dashboard-progress.test.mjs` 4/4 green locally after the bound
  widening; the rest of the diff is docs/evidence-only; compact-visual suite
  green at slice 3) ☑ · license gate ☑

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                | Expected disposition                                                                     | Test                                                            |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Control removal re-centers a `my-auto` card                            | missing-element skipped `unstable-case` at every width, never fabricated                 | 4 skips with reason in corpus-v2.json (observed)                |
| Remote subresources stall past the load deadline                       | `case-error` skip carrying the goto timeout reason                                       | 5 skips with reason in corpus-v2.json (observed)                |
| Instability specific to one family                                     | sb-admin-2 scores 56/56 in the same run, bounding the instability                        | corpus-v2.json per-family counts (observed)                     |
| Bar unmet under the register's unit                                    | reported, not padded; residual restated precisely (≥552)                                 | register C3 slice-4 bullet + evidence summary (observed)        |
| CI shard saturation stalls the nested child's boot past the poll bound | bounds widened together, property unchanged; interrupt still precedes any timeout result | two CI failures disclosed + local 4/4 after widening (observed) |
