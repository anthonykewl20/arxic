# FIX-302-front-baked-origin — staged doc updates (charter §10.2)

Issue: #302 · PR: #TBD · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #302 | [FIX-302-front-baked-origin] dg11 attestation front breaks baked-origin SPA targets — koel CORS-dead behind the proxy; multiple set-cookie collapsed (F-E3B; blocks DG-12 koel campaign) | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-24 | **#302 (FIX-302-front-baked-origin) attestation-front baked-origin SPA + set-cookie fidelity DONE.** The dg11 front rewrites app-origin absolute URLs to the front origin in text/html bodies (the nginx sub_filter role) so baked-origin SPAs (koel embeds http://<app-origin>/build/... in built HTML) boot behind the origin-differing proxy instead of CORS-dying; every upstream set-cookie now forwards as its own header (getSetCookie — Object.fromEntries collapsed XSRF-TOKEN+session pairs to the last one). Red-first real-Chromium harness test: a stub baked-origin SPA (absolute asset URL) never booted through the front before (script CORS-blocked → 0 forms) and boots after; two set-cookies survive to storageState (before: only the last); the well-known attestation stays byte-identical. Both consumers (dg11-run-validation, surface005-crawl-harness) share AttestationFront.start, so the fix propagates. **Next: DG-12 campaign round 4 under #256.** |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-302 attestation-front baked-origin SPA + set-cookie fidelity (#302): the dg11 rehearsal front rewrites app-origin absolute URLs to the front origin in HTML bodies (baked-origin SPAs — koel — CORS-died behind the origin-differing proxy: crawl shell 0/0/0, SURFACE-009) and forwards every upstream set-cookie header individually (the previous Object.fromEntries collapse dropped all but the last — Laravel's XSRF/session pairs). Harness-side only; no product code touched.
```

## 4. `VERSION` bump required?

no — rehearsal-harness fix; no shipped contract change.

## 5. Evidence pointers

- Red-first real-Chromium harness test: `packages/intent-proposal-spike/src/__tests__/attestation-front.real-world.test.ts` — a stub baked-origin SPA (absolute-URL script in body) boots through the real `AttestationFront.start` (before: `waitForSelector(form)` timed out 8s, script CORS-blocked); BOTH stub cookies reach `storageState` (before: only the last survived); the well-known attestation JSON is unchanged (origin, digest, environmentClass).
- Campaign evidence of the defect: `docs/evidence/DG-12/koel/runs/koel-dg12-run2/` (crawl shell 0 forms/0 controls/0 links behind the front; the live page renders its login in ~500ms direct) on `issue/256`.
- Gates: typecheck ☑ · lint ☑ · format ☑ · test (spike 81/81) ☐ license gate (CI)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                  | Expected disposition                                                      | Test                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| HTML body carries app-origin absolute URLs (baked build) | rewritten to the front origin; the SPA boots same-origin (observed)       | `boots a baked-origin SPA behind the front (absolute asset URLs rewrite to the proxy origin)` |
| upstream sets two cookies                                | BOTH forwarded as distinct set-cookie headers (observed via storageState) | `forwards EVERY upstream set-cookie header (no set-cookie collapsing)`                        |
| well-known attestation request                           | byte-identical behavior (regression pin)                                  | `serves the well-known attestation unchanged (regression half)`                               |

## 7. Not done / known-weak spots

- The rewrite is a literal `split/join` of the app origin string in HTML bodies only — inline JSON payloads carrying absolute URLs in NON-HTML content types (e.g. a `/api/config` JSON with baked origins) are not rewritten. koel's HTML was the measured blocker; if a JSON-baking target appears, extend the content-type list with a measured finding.
- `304 Not Modified` responses with no body: the rewrite is a no-op there (text is empty) — no ETag recompute, so a cached pre-rewrite body could briefly survive. Ephemeral rehearsal fronts start fresh; acceptable for the harness.
- AC-4 (koel campaign round 4 boots the SPA behind the front) executes under #256 after #301 (placeholder addressing) also merges.
