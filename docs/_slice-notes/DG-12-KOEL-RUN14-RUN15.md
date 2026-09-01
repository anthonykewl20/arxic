# DG-12-KOEL-RUN14-RUN15 — staged doc updates (charter §10.2)

Issue: #256 · PR: not opened · Disposition: mixed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #256 | [DG-12] EXIT GATE: ALL-domain intent extraction proven on two real third-party apps | open — Koel runs 14/15 reached stage 12 but were contradicted on the anonymous login-form assertion; replay ratio 0/2. |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-01 | DG-12 Koel runs 14/15: fresh real Chromium campaigns reached the deterministic verifier but each required replay found zero matching anonymous login forms (`Expected: 1 | Received: 0`), so both stage-10 artifacts are contradicted and the two-run replay ratio is 0/2. Evidence validation/redaction and deterministic-ledger rebuilds passed; screenshot-inventory retention separately failed closed. Next: investigate the retained form-observation and screenshot-inventory evidence before authorizing another campaign. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### internal`

```
- DG-12 Koel runs 14/15 (#256): retained fresh third-party campaign evidence and fail-closed verification results: both anonymous-login replays were contradicted (`Expected: 1 | Received: 0`), screenshot artifact retention was rejected by the privacy inventory gate, the pair replay ratio was 0/2, and redaction/ledger-determinism checks passed without recording a successful flow.
```

## 4. `VERSION` bump required?

no — evidence/reporting only; no user-observable capability changed.

## 5. Evidence pointers

- Real-world proof: `docs/evidence/DG-12/koel/runs/koel-dg12-hostbound-run14/artifacts/10.json` and `docs/evidence/DG-12/koel/runs/koel-dg12-hostbound-run15/artifacts/10.json` — real Chromium's two required replays per run failed at the generated unique-form assertion; deterministic verifier classified each candidate as `contradicted`.
- Sanitized provenance: `docs/evidence/DG-12/koel/runs/koel-dg12-hostbound-run{14,15}.environ-proof.json` and `docs/evidence/DG-12/koel/run12-run13-summary.md` — persona keys are hash-only and the prior preflight refusals remain retained.
- Artifacts: no screenshot, timeline, or trace is attached: `ARXIC-SCREENSHOT-INVENTORY-INVALID` rejected retention, so raw trace ZIPs were not retained.
- Focused gates: evidence validation/redaction (including live-key comparison) pass · per-run ledger rebuilds pass · DG-12 sweep fails only G-4 replay ratio (0/2) · `pnpm format:check` pass. Full typecheck/lint/test/license gates not run for this evidence-only tranche.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                | Expected disposition                        | Test                                                                                             |
| -------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Generated anonymous login form resolves to zero matching forms in each required replay | contradicted; no promotion                  | Real Chromium verifier artifacts `runs/koel-dg12-hostbound-run{14,15}/artifacts/10.json`         |
| Screenshot source inventory differs from the exact bound output set                    | blocked; no screenshot/timeline is retained | `ARXIC-SCREENSHOT-INVENTORY-INVALID` in each stage-10 artifact                                   |
| Evidence contains a persisted secret or current live key                               | blocked; validation fails                   | `validate-records.ts` over `docs/evidence/DG-12/koel` (zero findings; live-key comparison clean) |
| Ledger rebuild diverges from recorded artifacts                                        | blocked; determinism gate fails             | `dg12-determinism.mjs --rebuild` for run14 and run15 (both passed)                               |
