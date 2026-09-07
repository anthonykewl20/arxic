# Capture failure diagnostics — #448

The original CI five-of-six capture loss remains unexplained. This change adds
observability and recovery guidance; it does not establish or fix that cause.

The capture action now records a closed `failurePhase` describing its last
attempted operation: navigation, readiness, measurement, privacy-capture or
evidence-write. The original blocked disposition and generic machine finding
remain. The field is optional for historical results. No raw exception parsing,
request retry, privacy waiver or fabricated successful capture is introduced.
The dashboard groups each browser/theme/page label, recovery instruction and
failed-checkpoint count under “Findings and capture diagnostics.” This avoids
presenting a capture refusal as proof of a frontend defect.

## Real proof

`apps/web/src/__tests__/capture-failures.real-world.test.ts` boots the actual
vulnerable-auth-app and workbench on ephemeral ports with an isolated store.
The red run failed in16.18s: zero of six missing-page findings carried the
required navigation phase. Its masked screenshot and failed numeric audit are
retained in `before/`. All six healthy siblings were present in that run.

The initial grouped presentation passed the strengthened real journey in each
dashboard browser: Chromium19.32s, Firefox22.96s, WebKit20.47s. Every journey
executes the full Chromium/Firefox/WebKit × light/dark target matrix, retains
six healthy sibling captures alongside six navigation refusals, then proves
six required-mask refusals with zero captures. GUI assertions require the exact
recovery copy, no page errors, zero document overflow and zero automatic
accessibility violations; desktop and390px mobile screenshots are retained.
All three runs have nine named masked screenshots in total and three complete
sanitized action timelines. With the first red case, that initial selection contains ten
agent-inspected PNGs and four GUI timelines, plus four original engine timelines.
The source metadata remains `8176dd4`, dirty=true; it is not rewritten to a later
commit. Image and timeline hashes match their adjacent provenance.

The affected gallery and visual suite also passed four cases /three files
in144.21s before the final grouping-only presentation change. This result does
not substitute for final-head CI. The actual failure-guidance journey was then
rerun in all three engines after grouping. No assertion was loosened.

## Limits and reproduction

```sh
ARXIC_DASHBOARD_BROWSER=webkit ARXIC_CAPTURE_FAILURE_EVIDENCE_DIR=/tmp/arxic-capture-proof pnpm exec vitest run apps/web/src/__tests__/capture-failures.real-world.test.ts
```

Omit the browser override for Chromium; Firefox is also supported. Source CI
uses its shared evidence directory when no capture-specific directory is set.
The new field reports the attempted operation, not the underlying root cause.
Only navigation and required-mask failures were deliberately exercised here;
readiness, measurement and storage failure injection remain unproven. Browser
launch/context teardown failures remain environment-level diagnostics. No new
partial-result recovery from a crashed browser is claimed. Dark dashboard,
additional locales/personas and complete heuristic/human release sign-off are
not established by this slice. #448 and parent #402 remain open.


## Direct correction and rerun

A second real red test failed in19.81s because the blocked run had no direct
settings action (expected one, observed zero). The new **Edit capture settings**
button uses the existing project-edit action and only appears while the affected
project still exists. It does not modify a run or any privacy setting itself.

The final extended journey passed in Chromium30.09s, Firefox34.92s and
WebKit30.99s. A real click focuses the mask field before typing. The test checks
its edited value, saves through the GUI, runs all six browser/theme cells again,
and requires the successful run's persisted project mask to remain exactly
`h1`. It then opens the original blocked run and requires its zero captures and
original missing-mask snapshot to remain unchanged. This rejects success caused
by accidentally dropping the required privacy mask. No assertions were widened.
Result-summary scrolling makes both selected results visible in the proof.

The new [recovery evidence](./recovery/chromium/06-recovered-run.png) retains
four exact screenshot/timeline entries per browser and the second red guard.
All new images were agent-inspected and their hashes matched. Source metadata
is `6b09e45`, dirty=true; earlier evidence is preserved at its original source.
The complete selection now has **23 masked PNGs, eight GUI timeline files,
four original engine timelines and100 hash-checked machine artifacts**.
The shared installed-dashboard runner now includes this journey:24 tests in
14 files for every selected browser. Final-head installed CI remains required.
The original five-of-six capture-loss cause and #447 classification remain open.
