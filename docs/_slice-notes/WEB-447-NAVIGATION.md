# WEB-447-NAVIGATION — staged investigation updates

Issue: #447 · PR: #449 · Disposition: observed; investigation open

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

| #447 | WEB-447-NAVIGATION: corroborate WebKit navigation diagnostics | In progress; no exemption shipped |

## 2. `docs/SYNC.md` — session-log row (append to the table)

| 2026-09-07 | #447: real WebKit navigation diagnostic plus native-error/rejection, active-request and thrown-look-alike guards. Source corroborates browser-console reporting; per-document runtime classification remains open. |

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### internal`

- Add an explicit real WebKit navigation diagnostic with sanitized event evidence and native exception/adversarial request guards (refs #447). Existing no-error gates remain unchanged.

## 4. `VERSION` bump required?

No: diagnostic-only; no user-visible runtime change.

## 5. Evidence pointers

- [Proof](../evidence/WEB-447-NAVIGATION/summary.md): one real probe passed in 12.54 s, four inspected masked PNGs and hash-bound sanitized timeline/event records.
- Command/config: `scripts/navigation-probe.config.ts`; excluded from default test discovery because a non-reproducing run is inconclusive.
- Typecheck and lint passed; full-repository format after the note ended `All matched files use Prettier code style!`.
- Current-head CI remains required; this is not completed investigation work.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                              | Expected disposition                   | Test                            |
| ------------------------------------ | -------------------------------------- | ------------------------------- |
| Native throw and unhandled rejection | Observed by native and driver canaries | Explicit real WebKit diagnostic |
| Active request refusal               | Visible recovery; not exempt           | Explicit real WebKit diagnostic |
| Thrown fetch-look-alike              | Native exception remains observed      | Explicit real WebKit diagnostic |
| No navigation reproduction           | Inconclusive; no correction claim      | Reproduction assertion          |

No production error filter or lifecycle cancellation is shipped. Native event
absence alone cannot classify an error as harmless. Document/request identity,
early-login and back/forward cases remain open under #447.
