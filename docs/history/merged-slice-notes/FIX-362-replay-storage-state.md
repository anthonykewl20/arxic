# FIX-362-replay-storage-state — staged doc updates (charter §10.2)

Issue: #362 · PR: pending · Disposition: mixed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #362 | [FIX-362-replay-storage-state] Inject replay-persona storage state into per-pass replay contexts | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-01 | **#362 (FIX-362-replay-storage-state) replay-persona storage-state injection.** The verifier captures post-login browser storage per pass and provides it only to the generated replay fixture's child-process environment; the runner removes inherited state when none was supplied, and the fixture creates a storage-state context only for a non-empty declared value while anonymous replay retains cookie hygiene. Real Chromium against the bootable endpoint-less reference target produced two passing authenticated logout replays and two passing anonymous replays; bad credentials remained `blocked` through `ARXIC-VERIFY-FIXTURE-LOGIN-BLOCKED`. The deterministic verifier emitted the replay outcomes; this note does not assign a truth state. Next: #256. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

```
- FIX-362-replay-storage-state replay-persona storage-state injection (#362): preserve the authenticated per-pass persona session in the generated replay context without writing cookies or tokens into generated files or retained evidence; real Chromium replay covers authenticated, anonymous, and refused-credential paths.
```

## 4. `VERSION` bump required?

no — verifier defect repair; the integrator owns the release/version decision.

## 5. Evidence pointers

- Real-world proof: `apps/cli/src/__tests__/third-party-replay.real-world.test.ts` — real Chromium drove the bootable reference-auth-app behind its endpoint-less third-party proxy: two authenticated logout passes, two anonymous passes, and bad credentials refused.
- Artifacts: `/tmp/opencode/fix-362-proof/authenticated-pass-run-{1,2}-action-timeline.json`, named masked screenshots with `.privacy.json`, and trace-sanitization provenance; no trace ZIP is retained in the proof directory.
- Gates: typecheck ☑ · lint ☑ · format ☑ · targeted test (568 passing) ☑ · license gate ☐

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                          | Expected disposition                                                  | Test                                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Declared replay persona has rejected credentials | blocked with the existing `ARXIC-VERIFY-FIXTURE-LOGIN-BLOCKED` family | `refuses bad replay-persona credentials with the existing LOGIN-BLOCKED diagnostic (AC-3)` |
| No replay persona is declared                    | fresh anonymous context retains cookie hygiene                        | `keeps the no-persona replay context anonymous and hygienic (AC-2)`                        |
