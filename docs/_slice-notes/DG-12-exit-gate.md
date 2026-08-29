# DG-12-exit-gate — staged doc updates (charter §10.2)

Issue: #324 · PR: N/A · Disposition: blocked

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```text
| #256 | [DG-12] EXIT GATE: ALL-domain intent extraction proven on two real third-party apps | open — AC-4 live campaigns pending operator-held z.ai key; offline diagnosis and launcher staged |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```text
| 2026-08-27 | **#256 (DG-12) AC-4 offline staging resumed.** Run20 diagnosis, official z.ai protocol/pricing research, accounting-gap repair decision, and keyed launcher were staged; live campaigns remain blocked on the operator-held key. **Disposition: blocked.** Next: operator supplies the key, then run koel 24/25 and directus 21/22 serially. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### internal`

```text
- DG-12 AC-4 offline campaign staging (#256): documented the run20 accounting gap and z.ai coding-plan protocol constraints; staged a fail-closed keyed campaign launcher pending operator credentials.
```

## 4. `VERSION` bump required?

no

## 5. Evidence pointers

- Real-world proof: not run in this offline resume; prior real records are retained under `docs/evidence/DG-12/{directus,koel}/runs/`.
- Artifacts: `docs/evidence/DG-12/directus/runs/directus-dg12-run20/`; keyed launcher remains local-only at `/tmp/opencode/dg12-keyed-resume.sh`.
- Gates: typecheck ☐ · lint ☐ · format ☐ · test ☐ · license gate ☐ (live campaign gates pending credentials).

## 6. Current accounting and disposition

- Run20 is reconciled as a model-name-not-found failure before token generation: 0 cost, with a valid ledger entry and reconciliation rationale.
- Run21 recorded 3 calls at $0.0035 and blocked at stage 4.
- Run22 recorded 4 calls at $0.0051 and failed on schema-version drift; approved fix `615ce5a` pins the schema version.
- Current ledger headroom is approximately $0.8214 for directus and $0.8551 for koel. Next runs remain pending the operator-held key.

## 7. Orphaned run23 disposition

The `directus-dg12-run23/` directory is a record-less partial artifact from a killed session, created at approximately 01:27:34 +0800 and ending about 34 seconds later. It contains artifacts and stages but no run record or ledger entry, so no recorded spend is attributed to it. It is retained as-is for honesty; its successor will use a newly named run.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                        | Expected disposition                                                                 | Test                                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Run20 forwards produce no reconciled telemetry                 | blocked / invalid; freeze ledger pending reconciliation                              | Run20 `events[0]` accounting-gap and runner reconciliation at `dg11-run-validation.ts:1258-1261`            |
| z.ai coding-plan receives OpenAI `json_schema` response format | accepted by recorded runs 21/22; no adapter change is authorized unless drift recurs | Run22 returned four valid envelopes; schema-version drift was fixed by `615ce5a`                            |
| Operator key file missing or empty                             | blocked before probe or spend                                                        | `scripts/dg12-keyed-resume.sh` key-file guard                                                               |
| Evidence run contains symlinked package directories            | validator must recurse into symlink targets, not call `readFile` on a directory      | `validate-records.ts:559-567`; observed EISDIR at `.arxic-verification-suite/node_modules/@playwright/test` |
