# M1-BUNDLE-INTEGRITY — staged doc updates (charter §10.2)

Issue: #112 · PR: not opened by this worktree · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing #27 row verbatim)

```
| #27 | [M1-EXIT] Gate: two apps replay, no app-specific code | ☐ **measured, does not pass**: reference 14/14 · vulnerable 13/14 MET; §23.12 reproof tracked by #109; trace sanitization and screenshot privacy merged via #111/#115; staged workflow/manifest integrity fixed by #112 |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

The integrator may append this row after current-head CI passes:

```
| 2026-08-10 | **#112 (M1-BUNDLE-INTEGRITY) Staged bundle integrity integrated over #111/#115.** M0 and LangGraph actions project only complete deterministic verifier results into matching workflow/manifest status, run, gate, coverage, resolved-evidence, and artifact-hash claims; promotion rejects id/status contradictions, unresolved or invalid evidence, incomplete verified evidence, failed gates, blockers, dishonest coverage, and artifact/hash divergence before atomic replacement. The existing trace-sanitization and screenshot-privacy gates remain fail-closed before freeze/public replacement. Local real Chromium proof exercised coherent privacy-bound promotion for the reference Next.js and vulnerable Express apps, and the M0 reference path preserved last-known-good bytes. Full local suite: 91 files / 758 tests passed. CI remains for the integrator because this worktree intentionally opened no PR. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### fixed`

Apply only after current PR-head CI passes:

```
- M1-BUNDLE-INTEGRITY staged workflow/manifest integrity (#112): M0 and LangGraph action owners immutably project deterministic verifier outcomes into coherent workflow and manifest claims, while the bundle-promoter service rejects identity/status contradictions, unresolved or invalid evidence, incomplete verified runs or gates, failed gates, retained blockers, dishonest coverage, and manifest/artifact hash divergence with the existing stable blocked diagnostic before public replacement. The projection preserves trace/sanitization, screenshot/privacy, capture-runtime, and Playwright-config artifact refs for the merged #111/#115 gates. Local two-pass Chromium proof promoted coherent privacy-bound reference Next.js and vulnerable Express bundles; M0 proof preserved prior bytes. Frozen schemas and truth states are unchanged.
```

## 4. `VERSION` bump required?

yes → 0.0.1, because correcting publicly promoted workflow truth-state and integrity behavior is a user-observable patch under `RELEASES.md`. The integrator must update `VERSION` and root `package.json` together; this worktree changes neither.

## 5. Evidence pointers

- Real-world proof: `packages/bundle-promoter/src/__tests__/projection-real-world.test.ts` — real Playwright/Chromium compiled, ran twice with an action-owned screenshot privacy policy, projected, passed the independent promotion gates, and promoted coherent bundles against both the reference Next.js app and vulnerable Express app with trace retention disabled.
- M0 proof: `packages/m0-pipeline/src/__tests__/real-world.test.ts` — real Chromium projected runtime evidence and coherent workflow/manifest truth, promoted twice, then proved a failed later run left the prior public bytes intact. The merged capture path sanitizes retained traces and privacy-binds screenshots before projection.
- Artifacts: none retained or committed; raw traces, sanitized traces, privacy reports, screenshots, and promoted bytes existed only inside per-test temporary directories removed by test cleanup.
- Package documentation: update `packages/bundle-promoter/README.md` for cross-object validation/projection and `packages/m0-pipeline/README.md` for verifier-owned runtime evidence. No ADR decision, frozen schema, truth-state, or evidence-document update is required.
- Review: `ocr delegate preview --from origin/main --to HEAD` selected seven executable files; host review against the resolved OCR rules found no remaining integrity or security defect. Playwright's upstream `BrowserType.launch()` and `Browser.version()` implementations corroborate the trusted installed-browser version capture seam.
- Staleness sweep: `rg -n "M1-BUNDLE-INTEGRITY|#112|bundle integrity|staged workflow|manifest.workflow|workflow.status" docs packages/*/README.md CHANGELOG.md` found #112 only in this slice note and no historical claim to rewrite. `rg -n "M1-BUNDLE-INTEGRITY|#112|TODO|FIXME" .` additionally found only the generic slice-ritual wording in `docs/SYNC.md:191` and `docs/engineering-charter.md:155,160`; these are process instructions, not stale implementation debt. Existing ADR §2/§14/§15 statements remain accurate. `docs/SYNC.md`, `CHANGELOG.md`, and `VERSION` are intentionally deferred to the integrator under charter §10.2.
- Gates: `pnpm test` 91 files / 758 tests passed with Mailpit variables unset; `pnpm typecheck` and `pnpm -r typecheck` passed; `pnpm lint` passed; license gate 757 total / 0 rejected passed; `pnpm format` completed and the final post-note `pnpm format:check` reported `All matched files use Prettier code style!`. Current-head CI is intentionally not available because no PR was opened.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                                                            | Expected disposition                                                                      | Test                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Workflow id differs from `manifest.workflow.id`                                                                    | `blocked`; prior public bytes unchanged                                                   | `packages/bundle-promoter/src/__tests__/sad-paths.test.ts`                                                                     |
| Workflow and manifest statuses differ in either direction, including manifest `verified` / workflow `hypothesized` | `blocked`; prior public bytes unchanged                                                   | `packages/bundle-promoter/src/__tests__/sad-paths.test.ts`                                                                     |
| `verified` claim lacks the required all-pass run set or exactly one passed verifier gate                           | `blocked`; promotion action is not called                                                 | `packages/bundle-promoter/src/__tests__/projection.test.ts`, `packages/orchestrator-langgraph/src/__tests__/sad-paths.test.ts` |
| Workflow evidence is empty, invalid, unresolved, or a `run:*` id maps to non-runtime evidence                      | `blocked`; prior public bytes unchanged                                                   | `packages/bundle-promoter/src/__tests__/sad-paths.test.ts`                                                                     |
| `verified` manifest retains a failed gate, blocker, or contradictory coverage counts                               | `blocked`; prior public bytes unchanged                                                   | `packages/bundle-promoter/src/__tests__/sad-paths.test.ts`                                                                     |
| M0 clean runs omit browser evidence or report differing browser versions                                           | `blocked` before bundle projection                                                        | `packages/m0-pipeline/src/__tests__/sad-paths.test.ts`                                                                         |
| Original M0 workflow refs contain unresolved `doc:*` or `run:*` claims                                             | `blocked`; no receipt and prior public bytes unchanged                                    | `packages/m0-pipeline/src/__tests__/sad-paths.test.ts`                                                                         |
| Untrusted workflow/test output contains `ARXIC_BROWSER_VERSION:fake`                                               | trusted pinned-install version wins; spoof cannot originate the projected runtime version | `packages/playwright-agent-adapter/src/__tests__/real-world.test.ts`                                                           |
| Manifest file refs/hashes differ from staged artifact refs/hashes or artifact paths conflict                       | `blocked`; no partial verified projection and prior public bytes unchanged                | `packages/bundle-promoter/src/__tests__/projection.test.ts`, `packages/bundle-promoter/src/__tests__/sad-paths.test.ts`        |
| Contradictory values contain a credential-shaped canary                                                            | `blocked`; stable diagnostic contains no canary                                           | `packages/bundle-promoter/src/__tests__/sad-paths.test.ts`                                                                     |
| Atomic last-known-good snapshot fails after a prior public bundle exists                                           | `blocked`; prior public bytes remain byte-identical                                       | `packages/bundle-promoter/src/__tests__/sad-paths.test.ts`, `packages/m0-pipeline/src/__tests__/real-world.test.ts`            |
