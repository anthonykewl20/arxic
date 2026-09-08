# ATTESTATION-HINT-473 — staged doc updates (charter §10.2)

Issue: #473 · PR: #<PR> · Disposition: verified

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #473 | [ATTESTATION-HINT-473] Attestation pre-flight gives no actionable hint when the target redirects /.well-known to login | ☑ done — the fetch-failure diagnostic names the exact attestation path tried, the HTTP status, and the remedy (serve without redirecting or set attestationPath; recipe doc linked), and the guided-execution wizard documents the prerequisite next to the field; refusal dispositions unchanged |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-09 | **#473 (ATTESTATION-HINT-473) actionable attestation-fetch diagnostics DONE.** The live failure shape — auth middleware 307-redirecting `/.well-known/arxic-test-target.json` to `/login` — produced only `Attestation endpoint returned HTTP 307`: no path, no remedy, nothing in the UI either. `fetchAttestation` (`packages/environment/src/service.ts`) non-2xx errors now name the exact path tried and the status, state that the fetch never follows redirects, and give the remedy (serve the document at this path without redirecting, or set `attestationPath` to the served route — route recipe: `docs/attestation-for-your-app.md`); the message flows unchanged through the existing `ARXIC-ATTESTATION-FETCH-FAILED` wrapper, and every refusal disposition is untouched. The guided-execution wizard (`apps/web/src/frontend/project-wizard.tsx`) documents the prerequisite next to the Attestation path field with the recipe reference. Proven red-first: a real HTTP server answering the well-known path with 307 (plus 404 and a configured custom path with 500) produced path-less diagnostics on main (red retained) and the full actionable message after; a real-Chromium journey through the real dashboard (onboarding → discovery → settings dialog → Login and deployment declarations) asserts the note renders next to the field. No existing test pinned the old message; no label lookups break on the added `<small>`. Next: remaining #402 lanes (distinct-login-path personas 1d in flight, richer framework discovery, state coverage). |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### <added|changed|fixed|security|internal>`

```
### Fixed

- ATTESTATION-HINT-473 actionable attestation-fetch diagnostics (#473): a non-2xx or redirected attestation fetch now fails with a diagnostic naming the exact attestation path tried and the HTTP status, stating that redirects are never followed and giving the remedy — serve the attestation document at the path without redirecting or configure `attestationPath` — with the route recipe (`docs/attestation-for-your-app.md`) referenced; the guided-execution project wizard documents the same prerequisite next to the attestation path setting. Refusal dispositions are unchanged.
```

## 4. `VERSION` bump required?

no (integrator folds; user-observable diagnostic/UX improvement — candidate patch +1 at fold time per the #448 precedent, integrator's call)

## 5. Evidence pointers

- Engine real-world proof: `packages/environment/src/__tests__/attestation-redirect-hint.real-world.test.ts` — a real HTTP server answering `/.well-known/arxic-test-target.json` with **307 → /login** (the live mightybox shape), plus a plain-404 server and a custom `attestationPath` answered 500; all three refused with path-less diagnostics on main (red retained) and with the full actionable message after.
- UI real-world proof: `apps/web/src/__tests__/attestation-hint-ui.real-world.test.ts` — real Chromium through the real dashboard workbench: project onboarding, source discovery, settings dialog, expanding `Login and deployment declarations`, asserting the prerequisite note and the recipe reference render next to the attestation path field.
- Artifacts: `docs/evidence/ATTESTATION-HINT-473/{red,green}.txt`.
- Gates: typecheck ☑ (root + `typecheck:packages`) · lint ☑ · format ☑ (full repo, `All matched files use Prettier code style!`) · test ☑ (packages/environment 103/103 + both new lanes 4/4) · license gate — CI `package` job on the PR.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                       | Expected disposition                                          | Test                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------- |
| 307 redirect of the attestation path to /login                | refused; diagnostic names path + status + remedy + recipe doc | `attestation-redirect-hint.real-world.test.ts`          |
| plain 404 on the default path                                 | refused; same actionable hint shape                           | `attestation-redirect-hint.real-world.test.ts`          |
| custom `attestationPath` answered 500                         | refused; hint names the CONFIGURED path, not the default      | `attestation-redirect-hint.real-world.test.ts`          |
| attestation path off-origin / not starting with `/`           | refused (pre-existing, untouched)                             | `service.ts` guard + existing suites                    |
| production-looking target / unsigned receipt / nonce mismatch | refused (pre-existing, untouched)                             | `contract-gate.test.ts`, `preflight-real-world.test.ts` |
