# WEB-402-FINDING-EVIDENCE — staged doc updates (charter §10.2)

Issue: #402 · PR: #<PR> · Disposition: observed (findings stay `hypothesized`; nothing here assigns truth)

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
(No milestone row — #402 slice; record under the #402 status paragraph.)
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-09 | **#402 (WEB-402-FINDING-EVIDENCE) per-finding evidence, reproduction and independent acceptance DONE.** The second criterion's letter — every asserted defect LINKS to reproduction, screenshot and independent acceptance criteria — is now met in the data and the UI: after the existing closed-schema and region validation, every visual-review finding is stamped SERVER-SIDE (never model-authored — the schema's `additionalProperties:false` refuses model-injected evidence, pinned red-first: a forged-evidence provider response blocks the run and the forgery never serializes) with `evidence { screenshot: {runId, captureId, file, sha256, environment, viewport}, reproduction: {path, viewport, environment, deviceScaleFactor, browserVersion} }` from the real capture, and `acceptance { source: 'administrator' | 'none', independent, suggestedCheck }` — the administrator-supplied criterion when present, an EXPLICIT gap when absent; the model's suggested check stays labeled as a proposal in both data and UI. The run panel renders per-finding: a Screenshot-evidence link (the authorized capture URL), the Reproduce line (path · viewport · browser/theme · density · browser version) and the Independent acceptance block with the explicit no-criterion wording. Older persisted findings without stamps render without the block (guarded). Proven red-first on the REAL vulnerable-auth-app (real Chromium capture, real review through the local HTTP provider): exact stamped evidence against the real capture, the ''-criterion gap case, the forged-evidence block, secret-canary non-serialization, and a real-Chromium dashboard journey rendering the links. Remaining on this criterion: broader semantic evaluation and authenticated/state coverage; paid inference and the human release gate stay open. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### <added|changed|fixed|security|internal>`

```
### Added

- WEB-402-FINDING-EVIDENCE per-finding grounding for AI visual reviews (#402): every visual-review finding now carries server-stamped evidence — the exact authorized screenshot identity (run, capture, sha256, environment, viewport), a reproduction recipe (path, viewport, environment, pixel density, browser version) and its acceptance status (the administrator-supplied independent criterion, or an explicit gap marker when none covers it) — rendered in the dashboard as per-finding screenshot links, reproduction lines and acceptance blocks. The model's suggested check remains labeled a proposal; model-authored evidence is refused by the closed output schema (fail-closed, pinned).
```

## 4. `VERSION` bump required?

no (integrator folds; user-observable capability — candidate bump at fold time, integrator's call)

## 5. Evidence pointers

- API proof: `apps/web/src/__tests__/finding-evidence.real-world.test.ts` — the REAL vulnerable-auth-app (real Chromium capture, real review through the local HTTP provider): `evidence.screenshot` equals the exact capture record; `evidence.reproduction` equals the capture's path/viewport/environment/density/browserVersion; `acceptance` administrator/none matrix; the forged-evidence provider response BLOCKS (anti-SLOP) and never serializes; secret canaries absent.
- UI proof: `apps/web/src/__tests__/finding-evidence-ui.real-world.test.ts` — real Chromium through the real dashboard (project → visual run → review dialog with criterion → inspect → review): each finding renders its Screenshot-evidence link, the Reproduce line (800 × 600 …) and the Independent acceptance block.
- Artifacts: `docs/evidence/WEB-402-FINDING-EVIDENCE/{red,green}.txt` (including the two disclosed harness corrections: the string-criterion input contract, the connections-stub requirement).
- Gates: typecheck ☑ (root + packages + web) · lint ☑ · format ☑ full repo · test ☑ (2/2 new lanes; visual-review/visual-review-ui/visual-density-review/review-loop regressions) · license gate — CI `package` job.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                       | Expected disposition                                                                  | Test                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| provider injects its own `evidence` into a finding            | run BLOCKED by the closed schema; forgery never serialized                            | `finding-evidence.real-world.test.ts` (anti-SLOP pin) |
| no administrator criterion covers a finding                   | `acceptance {source:'none', independent:null}` — explicit gap rendered, never silence | same test + UI wording                                |
| finding region outside the screenshot                         | run blocked (pre-existing, untouched)                                                 | `visual-review.test.ts`                               |
| unaudited capture / sha mismatch / privacy provenance failure | review refused (pre-existing, untouched)                                              | `visual-review.test.ts`                               |
| older persisted findings without stamps                       | rendered without the grounding block (guarded optional field)                         | panel guard                                           |
| model suggestion mistaken for confirmation                    | `suggestedCheck` labeled AI proposal in data and UI; findings stay `hypothesized`     | UI journey + data assertions                          |
