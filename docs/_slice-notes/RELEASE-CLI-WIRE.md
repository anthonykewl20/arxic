# RELEASE-CLI-WIRE — staged doc updates (charter §10.2)

Issue: unfiled P0-1 · PR: pending · Disposition: mixed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```text
| P0-1 | [RELEASE-CLI-WIRE] Wire local CLI through model inference, auth candidates, compile, deterministic verification, and promotion | ☑ done with residual |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```text
| 2026-08-13 | **P0-1 (RELEASE-CLI-WIRE) local release CLI wiring DONE WITH RESIDUAL.** `arxic run --executor local` now constructs the configured model adapter, supplies auth-domain candidates after successful model inference, runs the existing default compiler, executes the real Playwright verifier, and delegates eligible bundles to the atomic promoter. A local OpenAI-compatible endpoint plus the real reference app and real Chromium produced two passing stage-10 runs; current sticky blocked discovery diagnostics keep the overall run blocked and promotion skipped, so the CLI does not yet produce an overall verified promoted bundle. No-model and unreachable-target paths remain blocked/observed without fabricated candidates. Worker execution is unchanged. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```text
- RELEASE-CLI-WIRE connects local `arxic run` to configured model inference, auth-domain candidate supply, the full default compiler, deterministic Playwright verification, and atomic bundle promotion; real Chromium proof reaches stage 10 with two clean passes, while existing sticky discovery blockers honestly prevent overall verified promotion.
```

## 4. `VERSION` bump required?

yes → next patch, because the change is user-observable per RELEASES.md

## 5. Evidence pointers

- Real-world proof: `apps/cli/src/__tests__/real-world.test.ts` — a real local OpenAI-compatible HTTP endpoint drives the real CLI against the real reference app; real Crawlee and Chromium reach deterministic stage-10 verification with two passing runs.
- Artifacts: CLI run directory includes sanitized verifier action timelines/provenance, named screenshots, traces, and stage artifacts; test temporary artifacts are removed after execution.
- Gates: typecheck ☑ · lint ☑ · format ☑ (`All matched files use Prettier code style!`) · test (106 files / 922 passing) ☑ · license gate (real dependency graph, 0 rejected) ☑

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                            | Expected disposition                                                                                                | Test                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Model endpoint credentials are absent              | `observed`/`blocked`; no candidate is fabricated                                                                    | `writes an observable run directory after driving the real pipeline and reference app` |
| Target is unreachable                              | `blocked`; run directory retained                                                                                   | `classifies an unreachable target as blocked while preserving an honest run directory` |
| Real model boundary and auth target are configured | deterministic stage 10 assigns `verified`; sticky earlier blockers keep overall run `blocked` and promotion skipped | `drives arxic run through deterministic stage-10 verification with the auth pack`      |
