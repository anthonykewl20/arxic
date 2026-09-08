# LABEL-SECRECY-474 — staged doc updates (charter §10.2)

Issue: #474 · PR: #<PR> · Disposition: verified

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #474 | [LABEL-SECRECY-474] Persisted-payload secrecy sweep false-positives on email input placeholders; whole campaign blocks at stage 5 | ☑ done — pattern-class matches inside recorded control `label` values (UI copy: aria-label → label text → placeholder → text content per DG-297) are masked whole with `__ARXIC_REDACTED_LABEL__` instead of refusing; every match outside a label value and every exact known-value hit keeps the fail-closed refusal |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-09 | **#474 (LABEL-SECRECY-474) label UI-copy secrecy masking DONE.** Real-world apps' standard `placeholder="you@example.com"` email inputs flowed into the DG-297 label-first chain and the write-time pattern-class scan refused the whole stage-5 surface artifact (`PersistedSecretError ['email-address']`, wrapped as `ARXIC-ORCH-STAGE-BLOCKED`) — 14/14 live mightybox campaign runs died this way. `redactAndScanPersistedPayload` now masks pattern-class matches that fall inside a serialized `"label":"…"` value, whole-value with the constant `__ARXIC_REDACTED_LABEL__` token (never partial-substring surgery), reporting `maskedLabelClasses` for attribution; order is known-value redaction → label masking → scan, so replay-persona literals keep the persona placeholder and every match OUTSIDE a label value still refuses (email, session-token, password-literal pins all red-if-broken). Proven red-first with a real journey — real Chromium (Crawlee) against a real page with the email placeholder, the placeholder captured into the persisted label, then the REAL FileStageCheckpointer refusing before the fix and persisting masked after — plus seam units (masking, any-pattern-class, outside-label refusal, persona precedence, untouched labels) and checkpointer units. No matcher widened; the pre-existing password-literal refusal pin is untouched and green. Policy call (issue option (a), narrowed to labels) disclosed for owner review on the PR. Next: #473 attestation-redirect hint. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### <added|changed|fixed|security|internal>`

```
### Fixed

- LABEL-SECRECY-474 email-placeholder labels no longer block campaign persistence (#474): the write-time persisted-payload sweep masks pattern-class matches inside recorded control `label` values (UI copy — the DG-297 aria-label → label → placeholder → text chain) with `__ARXIC_REDACTED_LABEL__` instead of throwing `PersistedSecretError`, so a target's standard `placeholder="you@example.com"` inputs stop killing every stage-5 surface artifact; pattern matches outside label values and exact known persona values keep the fail-closed refusal, and the masking is reported as `maskedLabelClasses`. Red-first proof includes a real-Chromium journey reproducing the exact live block and its masked-green counterpart.
```

## 4. `VERSION` bump required?

no (integrator folds; user-observable fix unblocking real-world campaigns — candidate patch +1 at fold time per the #448 precedent, integrator's call)

## 5. Evidence pointers

- Real-world proof: `packages/orchestrator-langgraph/src/__tests__/persist-label-masking.real-world.test.ts` — the REAL `CrawleeSurfaceDiscoverer` (real Chromium) inventoried a real HTTP page whose email input carries `placeholder="you@example.com"`; the probe's captured label was asserted BEFORE persisting; the REAL `FileStageCheckpointer.saveArtifact` refused with the exact live diagnostic on main (red retained) and persists masked (`__ARXIC_REDACTED_LABEL__`, `scanTextForSecrets` clean) after.
- Seam units: `packages/bundle-promoter/src/__tests__/label-masking.test.ts` (5 tests: whole-value masking + `maskedLabelClasses`, non-email classes, outside-label refusal, persona precedence, untouched labels).
- Checkpointer units: `packages/orchestrator-langgraph/src/__tests__/persist-label-masking.test.ts` (3 tests: stage-5 surface artifact with the DG-297 control shape persists masked; outside-label email still refuses; persona-value precedence).
- Artifacts: `docs/evidence/LABEL-SECRECY-474/{red,green}.txt`.
- Gates: typecheck ☑ (root + `typecheck:packages`) · lint ☑ · format ☑ (full repo, `All matched files use Prettier code style!`) · test ☑ (bundle-promoter + orchestrator-langgraph 336/336) · license gate — CI `package` job on the PR.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                              | Expected disposition                                                             | Test                                                     |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------- |
| same email outside any label value (`echo: 'contact admin@…'`)       | refused — `PersistedSecretError ['email-address']` (fail-closed unchanged)       | `persist-label-masking.test.ts`                          |
| session-token shape outside labels                                   | refusing diagnostic from the seam                                                | `label-masking.test.ts`                                  |
| password-literal in a credential-bearing artifact (pre-existing pin) | refused — unchanged, untouched assertion                                         | `persist-redaction.test.ts` (existing, green)            |
| replay-persona value inside a label                                  | silently replaced by the persona placeholder (known-value precedence, unchanged) | `persist-label-masking.test.ts`, `label-masking.test.ts` |
| label without any pattern hit                                        | persisted verbatim                                                               | `label-masking.test.ts`                                  |
| masked bytes re-scanned at audit time                                | clean (`scanTextForSecrets` over written `05.json` = [])                         | both masking suites                                      |
