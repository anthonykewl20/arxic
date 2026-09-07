# WEB-447-CLASSIFIER — staged doc updates

Issue: #447 · Branch: `fix/webkit-reload-447` · Disposition: classification proven; issue closure gated on exact-head CI

## 1. `docs/SYNC.md` — tracker row

| #447 | WebKit reload fetch diagnostics | Corroborated runtime classifier proven on three engines; exact-head CI pending |

## 2. `docs/SYNC.md` — session-log row

2026-09-07 (2): #447 mechanism proven with primary sources (WebKit `ThreadableLoader::logError` skips cancellations, logs teardown-initiated fetch failures as JS-source console errors; Playwright maps them to `pageerror`) and a deterministic stimulus (pagehide/tight-timer teardown fetches). Delivered `trackDashboardErrors`: exact shape + known endpoint + teardown marker + no same-endpoint non-cancellation `requestfailed` + no native error ⇒ `outgoing-document-fetch`; everything else stays hard. Three-engine proof with adversarial guards; `ui.real-world` adopted `hard()` with a deterministic retry-click order. Installed acceptance grows to eighteen dashboard files.

## 3. `CHANGELOG.md` — entry under `## [Unreleased]`

- Classify WebKit fetch-load driver diagnostics as outgoing-document evidence only under exact corroboration (message shape, known endpoint, teardown marker, no same-endpoint request failure, no native exception); active failures and thrown look-alikes stay hard errors on every engine. Make the journey's post-refusal retry click deterministic by retrying while the refusal is still routed (refs #447).

## 4. `VERSION` bump required?

No; test-side classification and a test-ordering fix — no user-facing behavior change. Integrator owns any fold decision.

## 5. Evidence pointers

- `docs/evidence/WEB-447-NAVIGATION/summary.md` (appended section) + `classifier/{webkit,firefox,chromium}/`: named masked screenshots, sanitized closed-category event records with hash-bound provenance, zero raw traces. Manifest rehashed (74 files).
- Proof runs: WebKit 26.26 s + 35.71 s stability rerun; Firefox 51.88 s; Chromium 24.44 s. Adopted `ui.real-world`: Chromium 2/2 (146.89 s), WebKit 2/2 (140.59 s), Firefox 2/2 (149.85 s).
- `scripts/` dashboard suites 8/8 after the eighteenth file registration; docs counts updated (README, apps/web/README, web-workbench: seventeen → eighteen).

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                           | Expected disposition                             | Test                                           |
| ------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------- |
| Fetch initiated during document teardown (WebKit) | `outgoing-document-fetch` diagnostic, not error  | Real WebKit stimulus loop (inconclusive fails) |
| Same teardown stimulus on Chromium/Firefox        | Zero driver events; nothing waived               | Real engine stimulus                           |
| Active-page `accessdenied` request refusal        | Hard error (same-endpoint non-cancel failure)    | Real three-engine refusal journey              |
| Thrown fetch-look-alike on an active page         | Hard error (native marker present)               | Real three-engine look-alike                   |
| Unrelated native canary                           | Hard error (shape unmatched)                     | Real three-engine canary                       |
| Non-reproducing WebKit stimulus round             | Test fails as inconclusive — never a silent pass | Stimulus reproduction assertion                |

Remaining: exact-head required CI (all gates incl. installed Firefox/WebKit partitions over the eighteen files), integrator fold, back/forward and multi-document lifecycle beyond the adopted journey, incidents #448 and the #402 release gates. No production readiness claim.
