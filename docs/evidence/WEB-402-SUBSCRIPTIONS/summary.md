# WEB-402-SUBSCRIPTIONS — account connections and provider-owned catalogs

Refs [#402](https://github.com/anthonykewl20/arxic/issues/402),
[PR #413](https://github.com/anthonykewl20/arxic/pull/413).
This proves the scoped connection/catalog addition, not the full web-product
release or the remaining React/shadcn migration. Version remains `v0.0.200`.

## Evidence and outcomes

| Probe | Recorded code | Result |
| --- | --- | --- |
| Real Chromium provider management | `ce0866c97d36c93dcbb39e2947be3af644994b38` | Pass: provider-returned IDs replace previous IDs, search survives updates, failed refresh remains visibly stale, 390px layout has no horizontal page overflow. External HTTP provider boundary is scripted; the dashboard and Chromium are real. |
| Native catalog metadata | `c7d6b66d11aed1d7df9300dafd044df0243f69cd` | Pass: Codex 7 IDs, Claude 5, OpenCode 41. No inference prompt or Arxic credential-cache reads. Snapshots are evidence, never production presets. |
| OpenRouter public catalog | `7db924d3afb25e4f4c46111abd94db9ddf3a7fcc` | Pass: 418 discovered IDs, 413 with usable advertised rates. No paid inference. |
| Codex account clean/regressed Next pair | `1dd209be259b42b1a980d9a4e384fce5a575b7d0` | Pass: native schema-enforced output, zero clean findings, one missing-submit-button hypothesis; 27,145 changed pixels. Selected model came from native discovery. |
| Claude account clean/regressed Next pair | `0c6231bf8898d9297747f6c750d442e8c3db48b1` | Pass for clean-screen and missing-button checks: zero clean findings; explicit missing-button hypothesis on the regressed screen. One additional informational check lacks visible support and remains a quality limitation. |

The live image surface is the actual Next.js reference login app. A persistent
CSS mutation clips its submit button. Independent browser geometry establishes
that the button is inside the card before and outside its clip after mutation.
Both fresh captures differ by 27,145 pixels. Workbench capture, baseline approval,
queued image review, native account CLI, schema validation and durable result
recording all execute. No model boundary is stubbed in these account probes.
All model findings remain **hypothesized**, never verified.

Installed CLIs: Codex 0.153.4, Claude Code 2.1.261, OpenCode 1.18.29. Native account
preflight checks reject API-key login for the subscription paths. Public model
IDs, image hashes and billing classification are retained; account identities and
credential stores are not. Subscription records show zero incremental API-token
estimate, not a free-usage or quota-enforcement claim.

## Inspectable artifacts

- Provider UI: [catalog](./ui/01-provider-catalog.png),
  [stale state](./ui/02-provider-stale.png), [mobile](./ui/03-provider-mobile.png),
  [timeline](./ui/timeline.json), [provenance](./ui/timeline.sanitization.json).
- Codex: [clean](./codex-final/01-baseline.png),
  [regressed](./codex-final/02-clipped-current.png),
  [results](./codex-final/results.json), [timeline](./codex-final/timeline.json).
- Claude: [clean](./claude-accepted/01-baseline.png),
  [regressed](./claude-accepted/02-clipped-current.png),
  [results](./claude-accepted/results.json), [timeline](./claude-accepted/timeline.json).
- Catalog snapshots: [Codex](./codex-catalog.json), [Claude](./claude-catalog.json),
  [OpenCode](./opencode-catalog.json), [OpenRouter counts](./openrouter-catalog.json).

Every PNG has adjacent privacy provenance; every timeline has adjacent
sanitization provenance. PNG and timeline hashes were checked. The three dashboard
images and the clean/regressed image bytes were agent-inspected; repeated native
capture files were checked byte-identical to those inspected images. No human
release inspection is claimed. Timelines contain allowlisted action labels and
outcomes only. No raw trace ZIP or raw provider transport log is retained here.

## Failures retained and fixes

1. The original native Claude pair emitted three style preferences on the clean
   screen: [original results](./claude-before/results.json),
   [failed timeline](./claude-before/timeline.json). Instructions now require
   objective visible evidence and exclude privacy-mask geometry and unsupported
   design assumptions. The clean-screen oracle remains zero findings.
2. Claude then exceeded the unchanged 500-character reproduction-check limit:
   [blocked result](./claude-schema-blocked.json). Native schema forwarding and
   structured-result handling fix this; no truncation or relaxed limit is used.
3. Codex rejected missing explicit types on the version constant and severity
   enum: [provider rejection](./codex-schema-rejection.json),
   [blocked pair](./codex-schema-before/results.json). Explicit string types
   preserve the same accepted values.
4. The initial lexical matcher missed the equivalent wording “No submit button
   visible.” Its original [result](./claude-final/results.json) and
   [failed timeline](./claude-final/timeline.json) remain intact alongside the
   [oracle review](./claude-final/oracle-review.json). The matcher explicitly adds
   this wording; this change is disclosed rather than represented as an unchanged
   assertion. The final fresh pair passes the corrected recognition, still
   requiring an independently established clipped button and zero clean findings.
5. A real subprocess ignoring SIGTERM survived metadata completion. The red test
   now passes after reaping the owned process group before returning.
6. Real browser testing exposed production/development JSX mismatch. Production
   React and production JSX compilation are now explicitly aligned.
7. CI 33979639411 on `7db924d` failed its unchanged canonical-capability check:
   catalog hashing duplicated SHA-256 outside contracts. The same test failed
   locally and passes after using the shared helper. Three other shards, static,
   fixture apps, packaging and worker image passed that first CI run. New-head CI
   remains required; this earlier run is not a completed gate.
8. An attempted concurrent native probe collided with Next's shared build lock.
   The final real-app probes run serially. This was a probe orchestration failure,
   not a passing app test.

## Validation and remaining scope

The full web area passed 46 tests in 13 files (230.75 s) before final schema and
architecture corrections. Changed schema/transport/architecture checks pass
locally after those corrections. Additional real HTTP safety checks reject
redirects without forwarding credentials, oversized bodies and malformed JSON.
Type checks, lint and the license gate passed; final PR-head CI is required.

Paid Kimi Coding, OpenCode Go, SuperGrok and OpenRouter inference are **not
live-validated** here. OpenClaw routing has a real local HTTP boundary test, not a
paid SuperGrok account probe. Native CLI catalogs may include models the account
cannot execute; availability and quota failures remain blocked. The complete
provider/defect evaluation matrix, richer account management, remaining shadcn
screens and the wider product requirements remain under #402. A clean result on
one reference screenshot does not establish a universal zero-false-positive or
complete visual detector.
