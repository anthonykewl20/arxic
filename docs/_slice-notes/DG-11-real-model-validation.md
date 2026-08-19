# DG-11 — real-model validation program (staged doc updates, charter §10.2)

Issue: #255 · PR: (this slice's PR) · Disposition: mixed — tooling/docs verified deterministically; the real-model boundary (G-3) is OWNER-GATED-PENDING by contract design

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #255 | [DG-11] Real-model validation program | ☑ done (tooling + docs; G-3 owner runs pending) |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-19 | **#255 (DG-11) real-model validation program DONE (tooling).** Shipped the env-gated validation runner (`packages/intent-proposal-spike/scripts/dg11-run-validation.ts`: spend ledger + budget-first preflight + recording model proxy + attestation front + sanctioned in-process `arxic run` invocation + sanitized record write), the G-1 record validator (`scripts/validate-records.ts`), 22 deterministic DG-11 tests in `real-model.test.ts` (SP-1/SP-2/SP-3 + validator matrix + ledger arithmetic + production-policy attestation proof), `docs/evidence/DG-11/README.md` + per-target config templates, and the koel FINDING (missing laravel rulepack → follow-up #283). Zero real model calls, zero credentials, zero product-package changes in this slice; G-3 runs execute later under owner credentials within the USD 1.00/app ceiling. **Milestone: DG-11 tooling complete; real-model evidence pending owner runs.** Next: #256 (DG-12 exit campaigns) after the owner's G-3 runs. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### added`

```
- DG-11 real-model validation program (#255): owner-executable validation runner with cumulative per-target spend ledger (fail-closed budget preflight, recording model proxy, attestation front for vanilla third-party targets) plus a closed-schema record validator — deterministic sad paths proven in CI (stub upstreams, zero spend), real-model runs owner-gated per docs/evidence/DG-11/README.md.
```

## 4. VERSION bump required?

no — validation tooling + docs only; no published package surface changed (spike is private, scripts are not exported).

## 5. Evidence pointers

- Real-world proof (deterministic lane, runs in CI): `packages/intent-proposal-spike/src/__tests__/real-model.test.ts` — stub upstream with hit-counter (zero upstream calls on refusals), production `verifyAttestation` over the front-served well-known, production `scanTextForSecrets` over sanitized candidates.
- Real-world proof (owner lane, PENDING): `docs/evidence/DG-11/<target>/runs/*.json` will carry `dg11-validation-run-v1` records once the owner executes G-3 (credentials are env-only and currently UNSET; this slice made zero real model calls by contract).
- G-4 artifact: `docs/evidence/DG-11/directus/refusals/dg11-g4-proof-directus-budget-ceiling.json` (upstreamCallsPlaced: 0).
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (spike 57 passing; full suite green) ☑ · license gate ☑ (CI) · ci check ☑ (see PR)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                         | Expected disposition                                                                                             | Test                                                                                                                                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SP-1: credentials absent/blank at run start     | refused-credentials, zero upstream hits (stub counter), refusal record                                           | `real-model.test.ts` "SP-1: refuses fail-closed when credentials are absent" + CLI proof `docs/evidence/DG-11/directus/refusals/dg11-sp1-proof-directus-credentials-missing.json` |
| SP-2: ceiling below estimate (preflight)        | refused-budget, zero upstream hits, refusal record with upstreamCallsPlaced 0                                    | "SP-2: refuses with a recorded refusal when the ceiling leaves less headroom than the estimate" + G-4 CLI proof artifact                                                          |
| SP-2: cumulative spend consumes ceiling         | refused-budget                                                                                                   | "SP-2: refuses when cumulative spend already consumes the ceiling"                                                                                                                |
| SP-2: ceiling reached mid-run                   | proxy refuses to forward (402 ARXIC-DG11-SPEND-CEILING), refusal recorded, upstream hits frozen                  | "hard-refuses to forward once measured spend reaches the ceiling"                                                                                                                 |
| SP-3: planted canary/secret in candidate record | sanitize-then-scan blocks; nothing unsanitized written                                                           | "blocks a planted canary" + "G-5 negative control: a planted secret in a record FAILS the directory validation"                                                                   |
| SP-4: post-run live-key scan hit                | quarantine path in runner (record never written, run invalid, ledger still charged) + `--live-key-env` scan mode | "live-key scan mode flags a directory containing the env value without printing it"                                                                                               |
| SP-5: pipeline defect mid-validation            | FINDING + follow-up issue, no in-slice product fix                                                               | OBSERVED: FINDING comment 5342958277 on #255 + follow-up #283 (koel laravel rulepack)                                                                                             |
| Ledger drift / schema drift                     | validator rejects                                                                                                | "rejects ledger arithmetic incoherence", "rejects an unknown top-level key", "validates spend-ledger.json coherence"                                                              |

## 7. Remediation round 1 — dual review of PR #284 (all 15 findings + docs-only)

Second commit on the same branch, same frozen surface. TDD: red tests first
for the four P1 findings (verified 11 red → implemented → green), P2/P3
implemented in the same pass with their own tests (48 total DG-11-adjacent
tests in `real-model.test.ts` now).

| #   | Finding (severity)                          | Disposition | Proof (test in `src/__tests__/real-model.test.ts`)                                                                                                                                                                                                                                       |
| --- | ------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Zero-price bypass (P1)                      | FIXED       | "preflight refuses fail-closed when either price is zero", "also refuses when only the completion price is zero", "validator rejects a run record with calls > 0 and both prices 0"                                                                                                      |
| 2   | Corrupt-ledger fail-open (P1)               | FIXED       | "readSpendLedger rejects corrupt JSON and incoherent ledgers", "preflight REFUSES on an unreadable ledger … file is preserved byte-for-byte", "loadSpendLedger: ENOENT is a legitimate fresh ledger", "validator: a run record whose runId has no entry in its target ledger is invalid" |
| 3   | Unrecorded-forward accounting gap (P1)      | FIXED       | "stop() drains in-flight forwards: a delayed upstream response still lands in telemetry after the client aborted", "forced-unparseable 200: forwarded=1 telemetry=0 → accounting-gap event + ledger entry freezes headroom to 0"                                                         |
| 4   | Overshoot self-invalidation (P1)            | FIXED       | "a forwarded call over the ceiling yields an honest record … arithmetic VALID (reviewer repro: 0.0312 vs 0.02)", "validator rejects cumulative > ceiling WITHOUT a ceiling-overshoot event", "validator rejects negative remainingUsd outright"                                          |
| 5   | Attestation front open-forward (P2)         | FIXED       | "rejects absolute-form, protocol-relative, and backslash request targets with 404 and zero forwards" (raw-socket probes; the bypass was OBSERVED reproducible pre-fix)                                                                                                                   |
| 6   | Proxy authenticates any local caller (P2)   | FIXED       | "401 with the static body and zero forwards on missing or wrong bearer; the canary bearer forwards"                                                                                                                                                                                      |
| 7   | Ceiling env ignored once ledger exists (P2) | FIXED       | "refuses when ARXIC_DG11_CEILING_USD differs from the existing ledger ceiling — raise AND lower; matching/unset pass"                                                                                                                                                                    |
| 8   | Commit pin asserted-not-observed (P2)       | FIXED       | "assertCloneAtPin accepts a clone at the pin and refuses a drifted HEAD naming both commits" (temp git repo fixture)                                                                                                                                                                     |
| 9   | --live-key-env silent skip (P2)             | FIXED       | "a missing live-key variable is a failure unless explicitly allowed; present values scan and detect" (`runLiveKeyScan`/`liveKeyMissingExitCode`)                                                                                                                                         |
| 10  | Stale framing headers (P2)                  | FIXED       | "strips content-encoding/content-length from a gzip-labeled upstream response"                                                                                                                                                                                                           |
| 11  | Run-id guard (P3)                           | FIXED       | "isValidRunId enforces the charset/length guard before any path use"                                                                                                                                                                                                                     |
| 12  | Model sentinel (P3)                         | FIXED       | 'model sentinel "unobserved" is valid with zero telemetry and INVALID with calls'                                                                                                                                                                                                        |
| 13  | ISO-8601 timestamps (P3)                    | FIXED       | "rejects non-ISO-8601 timestamps in run records, refusal records, and ledger entries"                                                                                                                                                                                                    |
| 14  | proxy.stop() on all failure paths (P3)      | FIXED       | structural: runRealValidation wraps everything post-start in try/finally (inner: env restore + proxy.stop + front.stop; outer: temp-dir cleanup); covered by the drain test's stop-path behavior                                                                                         |
| 15  | Coincidence repository fallback (P3)        | FIXED       | `DG11_TARGET_REPOSITORIES` explicit table replaces `github.com/<target>/<target>`; ledger/record repository fields now always come from it                                                                                                                                               |
| —   | Docs-only: single-runner discipline         | DONE        | README § "Single-runner discipline (accepted residual)" — no cross-process ledger lock, one runner per target, validator catches interleave after the fact                                                                                                                               |

Behavior notes for the integrator:

- **Schema-strengthening side effect:** every run record now REQUIRES a
  matching spend-ledger entry (validator rule from finding 2) — the two
  pre-existing accept-matrix test fixtures gained a ledger fixture. This is a
  tightening (the two prior "accept" fixtures would now be correctly
  rejected as unaccounted), not a loosening.
- **Ledger entry shape:** optional `accountingGap: true` field freezes the
  ledger's remaining headroom to $0 until manual repair (README documents
  the repair/adoption procedures).
- **Refusal reasons** extended: `zero-price`, `ledger-unreadable`,
  `ceiling-mismatch`, `commit-mismatch` (validator whitelist updated).
- **Post-run ledger-unreadable path** (finding 2, runner half): the run
  record is still written (spend was incurred) but nothing is appended, the
  corrupt file is preserved, and the validator's unaccounted-record rule
  keeps the directory red until manual repair — end-to-end runner-path test
  not feasible without booting a target; the underlying classification
  (`loadSpendLedger`) and the refusal plumbing are tested.
- README updates: preflight order (ledger integrity → ceiling agreement →
  prices → estimate → budget → credentials), pin assertion, drain/gap/
  overshoot semantics, `--allow-missing-live-key`, single-runner
  discipline, manual ledger repair & ceiling adoption, record-format table.
