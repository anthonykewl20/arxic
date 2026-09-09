# WEBKIT-DETAIL-543 — staged doc updates (charter §10.2)

Issue: #543 · PR: #544 · Disposition: observed

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #543 | [WEBKIT-DETAIL-543] WebKit dashboard journeys red on polled run/campaign detail endpoints | ☑ done |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-09 (12) | **#543 (WEBKIT-DETAIL-543) WebKit dashboard detail-endpoint classification DONE.** The #447 outgoing-document classifier recognized only the collection endpoints (`/api/state`, `/api/session`, `/api/runs`), but `refresh()` polls `/api/runs/<id>` and `/api/campaigns/<id>` whenever a row is selected — so WebKit's teardown diagnostic on a selected-run journey fell through to a hard error and red the run. Root-caused from the retained CI assertion payload of run 34361948664 (`capture-gallery-ui` line 385, `dashboard (webkit, 1/2)` only) and reproduced deterministically in 14 s by extending the classifier's own proof; three earlier sightings (#513, #539 `ui.real-world.test.ts:560`, #500) were the same class written off as contended-runner flakes. `endpointOf` now recognizes exactly one `[a-f0-9-]+` id segment — the server's own route shape — and labels it id-free (`/api/runs/:id`), so no run identifier reaches retained evidence and every detail path collapses to one endpoint for corroboration condition 4 (strictly more conservative). Ten dashboard-lane journeys moved off raw `pageerror` collectors onto the corroborated verdict. No waiver widened: active-page refusal, thrown look-alike and native canary stay hard on every engine. Next: #542 rebase, then #402/#423. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` (flat bullet list, matching the file's actual shape)

```
- WEBKIT-DETAIL-543 WebKit dashboard detail-endpoint classification (#543): the #447 outgoing-document classifier now recognizes the run and campaign detail endpoints the dashboard actually polls (`/api/runs/<id>`, `/api/campaigns/<id>`), closing a WebKit-only false red on every journey that navigates with a row selected. Recognition stays a closed one-segment `[a-f0-9-]+` match against the server's own route shape, endpoint labels are id-free so retained evidence carries no run identifier, and active-page refusals, thrown look-alikes and unrelated native errors stay hard on every engine. Ten dashboard-lane journey tests now take their no-page-error verdict from the corroborated classifier instead of a raw `pageerror` collector.
```

## 4. `VERSION` bump required?

no — test-harness classification only; no product code and no user-observable behavior changed.

## 5. Evidence pointers

- Real-world proof: `apps/web/src/__tests__/navigation-errors.real-world.test.ts` — real WebKit/Chromium/Firefox against a real booted workbench; the WebKit branch fails an inconclusive (non-reproducing) run rather than passing it.
- Red retained: `expected 2 to be +0` at `navigation-errors.real-world.test.ts:154` before the fix (two `/api/runs/<id>` teardown diagnostics classified `hard`); green on all three engines after.
- CI red that started this: run `34361948664`, `dashboard (webkit, 1/2)`, `capture-gallery-ui.real-world.test.ts` line 385, `phase=packed-web-browser-failed`.
- Gates: typecheck ☑ · typecheck:packages ☑ · lint ☑ · format ☑ · test ☑ · license gate ☑ (required CI)

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                                 | Expected disposition                                     | Test                                                                  |
| ----------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| Teardown fetch to a polled detail endpoint (`/api/runs/<id>`) on WebKit | classified `outgoing-document-fetch`, never a hard error | `navigation-errors.real-world.test.ts` `02b-detail-endpoint-teardown` |
| WebKit run that reproduces no teardown diagnostic                       | inconclusive → fails, never a silent pass                | `navigation-errors.real-world.test.ts` `02b-detail-endpoint-teardown` |
| Chromium/Firefox teardown on the same endpoint                          | silent; any page error stays hard                        | `navigation-errors.real-world.test.ts` `02b-detail-endpoint-teardown` |
| Active-page request refusal (no outgoing document)                      | stays hard on every engine; waiver count unchanged       | `navigation-errors.real-world.test.ts` `03-active-refusal`            |
| Thrown fetch-look-alike with the exact driver shape                     | stays hard; waiver count unchanged                       | `navigation-errors.real-world.test.ts` `04-thrown-lookalike`          |
| Unrelated native error                                                  | stays hard; waiver count unchanged                       | `navigation-errors.real-world.test.ts` `05-native-canary`             |
| Nested action path (`/api/runs/<id>/cancel`, `/artifacts/<name>`)       | unrecognized — no waiver is possible                     | `dashboard-errors.ts` closed one-segment match                        |
