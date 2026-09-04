# FIX-390-dg11-proxy-timeout — staged doc updates (charter §10.2)

Issue: #390 · PR: #391 · Disposition: verified

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #390 | [gate-finding] DG-11 recording proxy hardcodes a 120s upstream timeout — in-flight reasoning calls abort into accounting-gap INVALID runs (blocks the DG-12 koel lane, refs #256) | ☑ done — `ARXIC_DG11_UPSTREAM_TIMEOUT_MS` parameterizes the proxy upstream window (default 120_000, fail-closed on invalid); red-first loopback proof |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-04 (5) | **#390 (FIX-390-dg11-proxy-timeout) proxy upstream-timeout parameterization DONE.** The DG-11 recording proxy's hardcoded 120s upstream window aborted in-flight glm-5.3 reasoning calls on full-size structured-output batches (koel hostbound runs 17/18 → `accounting-gap`, run INVALID, headroom frozen 0). `resolveUpstreamTimeoutMs()` + `DG11_DEFAULT_UPSTREAM_TIMEOUT_MS` export; `ARXIC_DG11_UPSTREAM_TIMEOUT_MS` (positive integer ms, default 120_000, fail-closed refusal naming the variable on invalid values) resolved at proxy start and honored end-to-end by the upstream fetch signal. Red-first 4 unit tests over real loopback HTTP (default+override, invalid values, configured-timeout abort → 502 + zero telemetry, in-window forward → 200 + exactly one telemetry row); accounting semantics (gap detection, drain-on-stop, ceiling refusal) untouched; spike suite 98/98. Next: koel lane ledger repair + fresh DG-12 runs. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-390 DG-11 recording-proxy upstream timeout is operator-tunable (#390): `ARXIC_DG11_UPSTREAM_TIMEOUT_MS` (default 120000) replaces the hardcoded 120s upstream window in the DG-11 campaign runner's recording model proxy; invalid values fail closed before any forward. Reasoning-model batch calls that legitimately exceed the historical window no longer abort mid-flight into accounting-gap INVALID runs; fail-closed accounting semantics are unchanged.
```

## 4. `VERSION` bump required?

no — internal operator-tooling parameterization of the campaign runner (not part of the published CLI surface; v0.1.1 remains untagged)

## 5. Evidence pointers

- Real-world proof: `packages/intent-proposal-spike/scripts/__tests__/model-proxy-timeout.test.ts` — real loopback HTTP upstream through the real `RecordingModelProxy` (abort at configured window, forward within window, env resolution fail-closed)
- Artifacts: koel-dg12-hostbound-run17/run18 records (staged on the dg12-exit-final worktree) — the measured failure class this fix removes
- Gates: typecheck ☑ · lint ☑ · format ☑ (full-repo `format:check`: "All matched files use Prettier code style!") · test (spike 98/98) ☑ · license gate (CI package job) ☑

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                       | Expected disposition                                                                               | Test                                                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ARXIC_DG11_UPSTREAM_TIMEOUT_MS` unset                        | default 120_000 window (historical behavior preserved)                                             | `model-proxy-timeout.test.ts` — defaults to the historical 120s                              |
| `ARXIC_DG11_UPSTREAM_TIMEOUT_MS` = `0` / `-5` / `abc` / `1.5` | fail closed before any forward, refusal names the variable                                         | `model-proxy-timeout.test.ts` — fails closed on invalid values                               |
| upstream exceeds the configured window                        | abort at the configured timeout, 502 to the caller, zero telemetry rows (gap accounting unchanged) | `model-proxy-timeout.test.ts` — aborts a slow upstream at the configured timeout             |
| upstream lands within the configured window                   | 200 forward + exactly one telemetry row                                                            | `model-proxy-timeout.test.ts` — forwards a response that lands within the configured timeout |
