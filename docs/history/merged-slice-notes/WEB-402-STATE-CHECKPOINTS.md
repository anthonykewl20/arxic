# WEB-402-STATE-CHECKPOINTS — staged doc updates (charter §10.2)

Issue: #402 · PR: #<PR> · Disposition: observed (captures are observations; baselines stay operator-approved)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
(No milestone row — #402 slice; record under the #402 status paragraph.)
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-09 | **#402 (WEB-402-STATE-CHECKPOINTS) capturable state checkpoints DONE.** The third criterion's core: a project may declare STATE CHECKPOINTS — `stateCaptures: [{path, state, query}]` (≤20 unique triples, validated with distinct 400s) — operator-declared provocations for the loading/error/empty/authenticated states #509 declares and #518 may never observe by plain navigation; authenticated variants ride the existing per-project sign-in. The visual capture loop iterates configured paths then state checkpoints (navigate `path?query`), each capture tagged `stateVariant` with the variant INSIDE the specHash — every state checkpoint gets an independently versioned baseline through the unchanged baseline machinery — and the run summary names the count. The wizard gains a `/path state [query]` editor; the intent inventory renders a State checkpoints matrix (per route × state: declared? checkpointed?) exposing declared-without-checkpoint cells as the capturable omissions, with the plain-navigation honesty wording. Proven red-first on the REAL reference app (real build, real Chromium): the plain /login capture and the /login#error checkpoint both capture with distinct specHashes and distinct pixels (the error paragraph really renders under the query — the fixture's own behavior; the identity contract is what this slice pins), baselines key independently, the validation matrix refuses every malformed declaration, and a real-Chromium journey saves a checkpoint through the wizard and renders the matrix. Visual regressions 11/11 after the capture-loop refactor. Remaining: deterministic per-finding confirmation, paid inference, human release inspection. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### <added|changed|fixed|security|internal>`

```
### Added

- WEB-402-STATE-CHECKPOINTS state checkpoint coverage (#402): projects can declare state checkpoints — `/path state [query]` triples that provoke a route's loading, error, empty or authenticated state — captured as first-class visual checkpoints with independent versioned baselines (the state variant participates in the capture spec), editable in the project wizard and exposed as a per-route state-checkpoint matrix in the intent inventory that names every declared state without a checkpoint as a capturable omission. Operator-declared provocations only; captures remain observations with operator-approved baselines.
```

## 4. `VERSION` bump required?

no (integrator folds; user-observable capability — candidate bump at fold time, integrator's call)

## 5. Evidence pointers

- Real-app proof: `apps/web/src/__tests__/state-checkpoints.real-world.test.ts` — the REAL reference app (real build): the plain `/login` capture and the `/login#error` checkpoint (query `error=Invalid%20credentials`) both capture; distinct `specHash` (independent baselines), distinct PNG bytes (the error paragraph really renders — the fixture's own behavior), `stateVariant` on the record, the summary counts state checkpoints; the validation matrix (bad path/query/slug/missing name/duplicates/budget) refuses each with a distinct 400; `stateCheckpointCoverage` returns the exact `/login` matrix.
- UI proof: `apps/web/src/__tests__/state-checkpoints-ui.real-world.test.ts` — the wizard's State checkpoints editor saves through the real API and the intent inventory renders the matrix with the honesty wording.
- Artifacts: `docs/evidence/WEB-402-STATE-CHECKPOINTS/{red,green}.txt` (including the vulnerable-app-no-GET-/login correction).
- Gates: typecheck ☑ (root + packages + web) · lint ☑ · format ☑ full repo · test ☑ (3/3 new lanes; visual-review/visual/visual-auth 11/11) · license gate — CI `package` job.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                              | Expected disposition                                                              | Test                                   |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------- |
| malformed checkpoint (path w/o slash / path with query / bad slug / missing state / duplicate / >20) | distinct 400 at save, nothing captured                                            | `state-checkpoints.real-world.test.ts` |
| declared state without a checkpoint                                                                  | matrix cell `declared, no checkpoint` — capturable omission, not silence          | matrix + UI wording                    |
| checkpoint for an undeclared state                                                                   | matrix cell `checkpoint only` (operator knows something the source tier does not) | matrix derivation                      |
| state navigation fails like any capture                                                              | existing capture-blocked failure classification (untouched)                       | pre-existing suites                    |
| variant vs plain capture identity                                                                    | distinct specHash → independent baselines; never conflated                        | real-app test                          |
