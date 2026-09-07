# WEB-456-FOOTER — staged doc updates (in progress)

Issue: #456 · PR: not opened · Disposition: observed geometry; contrast remains unverified.

## 1. `docs/SYNC.md` — tracker row

```
| #456 | [WEB-456-FOOTER] Project-dialog footer audit evidence | ☐ in progress |
```

## 2. `docs/SYNC.md` — session-log row

```
| 2026-09-07 | **#456 (WEB-456-FOOTER), in progress.** Investigate six unresolved dialog-footer contrast checks. Opaque background does not resolve them and is not shipped. Add independent rendered-line containment and native hit-test evidence; local Chromium journeys pass, contrast remains explicitly unverified. Other engines and CI remain pending. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### Internal`

Stage only after required acceptance:

```
- WEB-456-FOOTER (refs #456): strengthen project-dialog footer visibility evidence with rendered-line and native hit-test checks; retain unresolved automated contrast results and the failed background experiment without a waiver.
```

## 4. `VERSION` bump required?

No production behavior changes are proposed. This is test evidence and audit classification; integration handles the shared release bookkeeping.

## 5. Evidence pointers

- [Investigation record](../evidence/WEB-456-FOOTER/summary.md), failed probes, masked PNGs and timelines.
- `apps/web/src/__tests__/visual-density-ui.real-world.test.ts`: real dashboard and reference app. Two Chromium light/dark cases pass locally; Firefox/WebKit, installed proof and exact-head CI remain pending.
- All pre-existing assertions remain. The experimental zero-incomplete expectation was explicitly withdrawn; no opaque CSS workaround ships.

## 6. Sad paths proved

| Trigger                                                  | Disposition                    | Evidence                                                       |
| -------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------- |
| Require zero incomplete contrast results                 | Contradicted by the real audit | Retained red captures                                          |
| Add opaque footer background                             | Does not resolve uncertainty   | Retained failed probe; change removed                          |
| Treat visible text as proof of full contrast conformance | Unsupported                    | Computed pair and sampled line visibility have explicit limits |

Do not mark this slice complete or claim full WCAG/UX conformance. #402 remains open. The native-density parent PR #455 must be resolved before integration.
