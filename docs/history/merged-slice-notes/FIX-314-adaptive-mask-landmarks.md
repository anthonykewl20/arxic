# FIX-314-adaptive-mask-landmarks — slice note

Issue: #314 · Status: fixed on this branch, awaiting CI + AC-4 round-9 field proof · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #314 | [FIX-314-adaptive-mask-landmarks] masked-page capture adapts its mask set to the page's real landmarks when a declared anchor is absent (receipt discloses `maskAdaptation`) — directus-shaped pages (no `<main>`) capture | ☑ done (code; AC-4 round 9 pending) |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-25 | **#314 (FIX-314-adaptive-mask-landmarks) adaptive mask fallback.** Root cause (round-8 field evidence + live probes): `cliScreenshotPolicy` declares `masks: [{ role: main, exact: true }]` unconditionally and the runtime's mask-inventory check fails capture when a declared mask resolves to zero elements — the directus admin SPA shell has NO `<main>` landmark (probed: main/article/form/aside/nav/header/footer all getByRole 0; `locator('form')` = 1 — ARIA maps `<form>` to role form only when named). Fix, entirely inside the capture path: when a declared mask misses (or exceeds) its bound, the runtime probes the page's LANDMARK ELEMENTS (literal tag selectors `main|article|form|aside|nav|header|footer`, in preference order, per-locator 1..64 and total 256 caps unchanged) and masks that set instead — masking is a hiding operation, so the adapted set can only hide MORE than the declared anchors would have; a page with NOTHING maskable still fails closed with the same error. Every adaptation is disclosed on the untrusted receipt via a new optional `maskAdaptation: string[]` field (parser + canonical round-trip extended, bounded `[a-z]{2,20}` entries); receipts without it are unchanged. The compile-time non-semantic-locator gate was NOT widened: the fixed package-owned runtime sources (transition receipts + screenshot privacy) are now passed as `fixedRuntimeSources` and excluded from the per-workflow LOCATOR scan only (forbidden-API and secret scans still cover every byte); the allowlist for generated sources stays exactly `page.locator('form')`. Red-first: real-Chromium capture test against a no-`<main>` page (red pre-fix, green post-fix with `maskAdaptation: ['form']`); regression pin (declared masks resolve → capture unchanged, no adaptation recorded); the old declared-miss blocking test now pins the true fail-closed condition (landmark-free page). **Local-env note: the worker e2e failed until the cached `arxic-worker:dev` Docker image was rebuilt** — the promoter's independent provenance gate hash-compares the bundle's baked runtime against current package source; a stale local image mismatches ANY runtime-source change (CI builds the image fresh, so it never saw this). **Next: DG-12 round 9 under #256 (AC-4).** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-314 adaptive mask landmarks (#314): masked-page screenshot capture adapts to pages whose declared mask anchor is absent (e.g. no `<main>` landmark, the directus admin shell) by masking the page's real landmark elements instead — disclosed per-capture via the receipt's optional `maskAdaptation` field; per-locator/total mask bounds, fail-closed behavior on nothing-maskable, and all provenance gates unchanged.
```

## 4. `VERSION` bump required?

no — capture-runtime behavior extension with a backward-compatible optional receipt field; no shipped contract or schema change.

## 5. Evidence pointers

- Defect evidence: `docs/evidence/DG-12/directus/runs/directus-dg12-run8/` stage-10 (`ARXIC-SCREENSHOT-CAPTURE-FAILED: declared mask locator inventory is missing or exceeds its bound` in both runs, then downstream `SCREENSHOT-INVENTORY-INVALID`); live probe of `http://127.0.0.1:8055/admin/login`: every landmark `getByRole` count 0, `locator('form')` = 1.
- Fix: `packages/playwright-screenshot-privacy/src/standalone-runtime.ts` — `ADAPTIVE_MASK_PROBES` (literal landmark-tag locator factories, preference order), `adaptiveLandmarkMasks()` respecting the 64-per-locator/256-total caps, adaptation recorded as optional `maskAdaptation` on the untrusted receipt; parser lifts the optional key before the strict exact-key check and round-trips it canonically; `packages/playwright-compiler/src/compile-policy.ts` + `compiler.ts` — `fixedRuntimeSources` split (locator scan scope), no allowlist change.
- Red-first tests: `packages/playwright-screenshot-privacy/src/capture-runtime.real-world.test.ts` — `'#314 adapts masked-page masks to present landmarks when the declared anchor is absent'` (red pre-fix: the exact stage-10 error; green post-fix with `receipt.maskAdaptation = ['form']`), `'#314 uses declared masks unchanged when they resolve'` (green pin both sides), updated `'blocks a masked-page capture when a declared semantic mask resolves to nothing'` (now a landmark-free page — DISCLOSED matcher/test change: the page under the old test wrapped content in `<main>`, which under adaptation legitimately captures; the fail-closed property it pins moves from "any declared miss" to "nothing maskable", which is the honest invariant).
- Gates: screenshot-privacy + verifier + compiler + orchestrator-langgraph + cli (incl. real-Docker worker e2e on a REBUILT image) + m0-pipeline + bundle-promoter + intent-proposal-spike = 79 files / 777 tests passed; typecheck/lint clean; `format:check` after this note: `All matched files use Prettier code style!`

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                | Expected disposition                                                                                   | Test                                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| declared anchor absent, landmarks present                              | capture succeeds; adapted set is a superset-hide; receipt discloses roles (observed, real Chromium)    | `#314 adapts masked-page masks…`                                                 |
| declared masks resolve                                                 | capture unchanged; no `maskAdaptation` recorded (observed, real Chromium)                              | `#314 uses declared masks unchanged…`                                            |
| landmark-free page (nothing maskable)                                  | fails closed with the mask-inventory error; no artifacts retained (observed, real Chromium)            | `blocks a masked-page capture when a declared semantic mask resolves to nothing` |
| receipt with malformed `maskAdaptation` (empty/non-string/bad charset) | `ARXIC-SCREENSHOT-RECEIPT-INVALID` (observed, unit parser)                                             | policy/attestation suite                                                         |
| adapted set exceeding bounds                                           | fails closed with the same inventory error before capture (code path mirrors the declared bound check) | runtime bound logic                                                              |

## 7. Not done / known-weak spots

- AC-4 (real directus round-9 stage-10 passes capture and completes verification) executes under #256 after this merges — this slice's real-world proof is real-Chromium fixture capture plus the worker e2e.
- The adapted landmark preference order is static (main > article > form > aside > nav > header > footer); a page whose ONLY landmark is a header-sized `<header>` will mask it and capture — correct per the hiding-superset argument, but the visual result may be mostly black.
- `maskAdaptation` rides the UNTRUSTED receipt (disclosure only). The privacy ATTESTATION does not yet echo it; if downstream provenance needs to bind adaptations, that is a follow-up schema change (deliberately not smuggled into this slice).
- Local dev only: a stale cached `arxic-worker:dev` image fails the worker e2e on ANY runtime-source change; rebuild with `docker build -f apps/worker/Dockerfile -t arxic-worker:dev .` (CI is unaffected — it builds fresh).
