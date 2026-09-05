# DG12-PREAUTH-LOGIN-SURFACE — staged doc updates (charter §10.2)

Issue: #350 · PR: pending (worktree deliberately uncommitted) · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #350 | [gate-finding] authenticated pre-crawl login (#297) hides anonymous-only login forms from breadth discovery — koel compiles nothing (dg12-hostbound-run5) | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-08-30 | #350 (DG12-PREAUTH-LOGIN-SURFACE): the adapter retains the structural form observed by the real pre-crawl replay-persona login before values are filled, preserving an anonymous-only login surface for authenticated breadth discovery. The read-only koel run5 decisions were "No exploration steps; nothing to observe" (stage 8) and "Plan retained as uncompiled" (stage 9). `adapter.ts:405-466` invokes the login capability and attributes the probe to the actual pre-submit URL; `adapter.ts:73-151` supplies the value-free breadth shape. Real Chromium adapter test passed; field proof remains pending koel run6. refs #256 refs #324 refs #348. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- DG12-PREAUTH-LOGIN-SURFACE authenticated pre-crawl login surface (#350): retain the real login form's structural, value-free crawl surface before replay-persona values are filled, so anonymous-only forms remain available to the existing proposal compiler after authenticated discovery.
```

## 4. `VERSION` bump required?

no — this is an unreleased behavior correction; the integrator decides the release patch bump.

## 5. Evidence pointers

- Read-only field finding: `.worktrees/dg12-exit/docs/evidence/DG-12/koel/runs/koel-dg12-hostbound-run5/stages/08.json` and `stages/09.json` — decisions quoted above; no raw trace retained or attached.
- Real-world proof: `packages/crawlee-adapter/src/__tests__/authenticated-crawl.real-world.test.ts` — real HTTP form app plus real Chromium verifies the retained `/login` form's action, method, labelled email/password controls, submit label, and absence of both persona values.
- Artifacts: local Vitest output only; this harness retains no screenshots or action timeline. Koel run6 must provide the sanitized action timeline, adjacent sanitization provenance, and named screenshots before field behavior is claimed.
- Gates: typecheck passed · lint passed · format pending after this note · targeted adapter test 27 passing.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                           | Expected disposition                                                                                                         | Test                                                                                            |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Login refuses the persona credentials, so there is no successful pre-login observation to retain. | blocked — the adapter emits `ARXIC-SURFACE-009` and maps the anonymous tier.                                                 | `emits a blocked diagnostic and still maps the anonymous tier when the login is refused`        |
| A persona email or password appears in the retained login surface.                                | blocked by the regression assertion; the capture executes before fields are filled and the emitted probe has no value field. | `crawls the authenticated tier when the declaration resolves, and the anonymous tier otherwise` |
