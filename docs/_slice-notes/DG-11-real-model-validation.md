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
