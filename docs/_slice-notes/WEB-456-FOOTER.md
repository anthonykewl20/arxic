# WEB-456-FOOTER — staged doc updates (in progress)

Issue: #456 · PR: #457 · Disposition: mobile action row and tablet target-size defects reproduced; fixes under validation; contrast remains unverified.

## 1. `docs/SYNC.md` — tracker row

```
| #456 | [WEB-456-FOOTER] Project-dialog footer audit evidence | ☐ in progress |
```

## 2. `docs/SYNC.md` — session-log row

```
| 2026-09-07 | **#456 (WEB-456-FOOTER), in progress.** Investigate six unresolved dialog-footer contrast checks. Opaque background does not resolve them and is not shipped. Add independent rendered-line containment and native hit-test evidence; initial three-engine geometry passes; mobile action separation and tablet target size are reproduced and corrected. Revised browser checks and CI remain pending; contrast stays unverified. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### Internal`

Stage only after required acceptance:

```
- WEB-456-FOOTER (refs #456): keep Back and Save together in project settings and make dialog-footer actions at least 44 pixels tall. Strengthen line-containment and hit-test evidence; retain unresolved contrast results without a waiver.
```

## 4. `VERSION` bump required?

Yes: the follow-up groups settings actions and makes dialog-footer actions at least 44 pixels tall. Integration handles the synchronized version; this worktree does not edit shared metadata.

## 5. Evidence pointers

- [Action-row and target-size red proof](../evidence/WEB-456-FOOTER/action-row/summary.md): 114-pixel row drift at 320 and 32-pixel action heights at 768, both themes; assertions remain strict.
- [Investigation record](../evidence/WEB-456-FOOTER/summary.md), failed probes, masked PNGs and timelines.
- `apps/web/src/__tests__/visual-density-ui.real-world.test.ts`: real dashboard and reference app. Revised light/dark cases pass locally in Chromium (33.18 s), Firefox (46.44 s), and WebKit (35.92 s); installed proof and exact-head CI remain pending.
- Broader Chromium navigation/modal-focus/forced-colors/session-expiry audit passes (1 case, 35.36 s), retained in the action-row evidence.
- All pre-existing assertions remain. The experimental zero-incomplete expectation was explicitly withdrawn; no opaque CSS workaround ships.

## 6. Sad paths proved

| Trigger                                                  | Disposition                    | Evidence                                                       |
| -------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------- |
| Require zero incomplete contrast results                 | Contradicted by the real audit | Retained red captures                                          |
| Add opaque footer background                             | Does not resolve uncertainty   | Retained failed probe; change removed                          |
| Treat visible text as proof of full contrast conformance | Unsupported                    | Computed pair and sampled line visibility have explicit limits |

Do not mark this slice complete or claim full WCAG/UX conformance. #402 remains open. Parent PR #455 merged as `aa661279` after required CI passed. This branch transplants only the footer changes onto that base; exact-head PR #457 acceptance remains pending.
