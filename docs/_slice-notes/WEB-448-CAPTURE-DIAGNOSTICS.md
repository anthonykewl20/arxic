# WEB-448-CAPTURE-DIAGNOSTICS — staged doc updates

Issue: #448 · PR: pending · Disposition: observed diagnostics; cause investigation open

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

| #448 | Capture failure phase and recovery guidance | In progress; original missing-capture cause unresolved |

## 2. `docs/SYNC.md` — session-log row (append to the table)

| 2026-09-07 | #448: capture actions report bounded failed operations; dashboard groups environment/page labels with recovery guidance. Real six-cell navigation and required-mask refusal journeys passed in all three dashboard browsers. Original CI cause remains open. |

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### changed`

- Explain failed capture operations beside the affected browser/theme/page, with grouped recovery guidance on desktop/mobile. Keep historical results compatible and all privacy/blocked outcomes intact (refs #448).

## 4. `VERSION` bump required?

Yes: user-visible diagnostic guidance; integrator applies the next patch increment per RELEASES.md. No VERSION or global changelog edit in this worktree.

## 5. Evidence pointers

- [Real proof](../evidence/WEB-448-CAPTURE-DIAGNOSTICS/summary.md): red missing classifications; all-three-engine desktop/mobile journeys over real six-cell target matrices, masked PNGs and hash-bound sanitized timelines.
- Actions own the failed-operation classification. Screenshot/measurement mechanics remain in their existing services; the frontend helper formats fixed recovery copy only.
- Current-head CI is required before integration. This diagnostic increment does not complete #448.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                   | Expected disposition                                          | Test                          |
| ------------------------- | ------------------------------------------------------------- | ----------------------------- |
| Missing reference page    | Blocked navigation per matrix cell; healthy siblings retained | Real failure-guidance journey |
| Missing required mask     | All captures blocked; no retry/waiver                         | Same journey                  |
| Recovery text on mobile   | Zero overflow/automatic a11y violations; no page errors       | Same journey at390px          |
| Unknown original CI cause | Remains unresolved                                            | #448 stays open               |

Readiness/measurement/storage injection, browser teardown recovery and human release inspection remain gaps. No cause is inferred from a later passing matrix.
