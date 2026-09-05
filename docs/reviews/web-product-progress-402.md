# Web product progress and remaining release work — #402

This records the expanded web-product work for `v0.0.200`. It does not replace
the historical engine audit or establish readiness for the full public web release.
The acceptance contract remains [the web product specification](../web-product-spec.md).

## What the current application provides

| Requirement                    | Current behavior and evidence                                                                                                                                                                                                                                                                                                                                                                            | Remaining release work                                                                                                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local/server web application   | Source-checkout installation, persistent SQLite, project roots, queued jobs, restart recovery and a token-authenticated administrator dashboard. [Installation proof](../evidence/WEB-402-INSTALL/summary.md).                                                                                                                                                                                           | Clean server distribution and broader deployment/runtime onboarding proof.                                                                                                        |
| Polished React/shadcn frontend | Workspace shell, overview, inventory, selection, campaigns, run/capture review, model fields, schedules, administration and Models & accounts use React/shadcn. Existing shared API/form actions and native dialogs remain. [Workspace](../evidence/WEB-402-SHADCN/summary.md), [inventory](../evidence/WEB-402-INVENTORY-UI/summary.md), [run/review](../evidence/WEB-402-RUN-REVIEW/summary.md) proof. | Richer connection/account and runtime controls. A presentation migration does not complete the product feature matrix.                                                            |
| Provider/model agnosticism     | No built-in model catalog. Named providers and configured default HTTP connections refresh provider-owned IDs, preserve custom input, disclose stale results and bind caches to accounts. [Catalog proof](../evidence/WEB-402-DEFAULT-CATALOG/summary.md).                                                                                                                                               | Opaque host/gateway defaults require an explicit named discovery adapter. Metadata does not establish execution entitlement.                                                      |
| Subscription/account plans     | Native Claude/Codex/OpenCode bridges, OpenCode Go and Kimi/OpenRouter profiles, dedicated OpenClaw routing for eligible Grok accounts. Login remains owned by server-installed native tools. [Subscription proof](../evidence/WEB-402-SUBSCRIPTIONS/summary.md).                                                                                                                                         | Fresh paid Kimi/Go/SuperGrok/OpenRouter inference has not been validated. Browser account-login flows are not implemented.                                                        |
| Deep frontend discovery        | Route/domain inventory, JS/TS/JSX/TSX declarations and documentation requirements with line/hash evidence, filters and explicit gaps.                                                                                                                                                                                                                                                                    | Semantic business-intent synthesis, more frameworks and source-to-runtime state mapping. Source declarations do not reveal every hidden requirement.                              |
| AI functional campaigns        | Guided on-demand selection, one serialized engine run per selected source row, full denominator and deterministic per-workflow outcomes. Real Next/Mailpit workflows pass two verifier replays in retained tests.                                                                                                                                                                                        | Recurring selected campaigns, broader personas/flags/states and independent business acceptance criteria. Latest inventory/ledger views do not union all prior campaign outcomes. |
| Real visual regression         | Stable anonymous path/viewport capture, explicit baseline approval, actual pixel differences and image-grounded AI hypotheses with model provenance.                                                                                                                                                                                                                                                     | Authenticated workflow checkpoints, responsive/state matrices, broader detector evaluation and reviewed baseline lifecycle.                                                       |
| Scheduling/admin               | Durable UTC cron for individual runs, pause/resume, missed-slot coalescing, cancellation, root restrictions and audit history.                                                                                                                                                                                                                                                                           | Campaign/worker coordination, retention/runtime management and applicable notification policies.                                                                                  |
| Session/submission correctness | Draft consent is discarded on logout or session loss; pending submissions survive navigation; late responses cannot mutate a new session. [Session proof](../evidence/WEB-402-SESSIONS/summary.md).                                                                                                                                                                                                      | Broader adversarial testing as new actions and account flows are introduced.                                                                                                      |

## Defects reproduced in the latest browser work

- A review enqueue left model/criterion settings editable until its response arrived.
- A project filter changed the run list but retained the previous project's detail panel.
- Losing a session retained an unsent review draft and screenshot consent after re-login.
- Navigating away/back re-enabled pending review controls.
- Pending campaign selections remained editable across navigation.
- A late campaign response redirected a newly authenticated session.
- Configured default HTTP connections rejected catalog discovery and disabled Refresh.
- Models & accounts omitted the configured default provider.
- Default HTTP billing metadata produced the wrong visible billing label.

These failures have exact regression assertions and scoped proof in the linked
records. The UI never assigns a deterministic `verified` outcome itself; it displays
server-produced outcomes and keeps AI findings labeled as hypotheses.

## Merge status

The React/shadcn workspace, inventory, run/review and session fixes are merged in
PRs #414–#417. Default-provider discovery is merged in
[PR #418](https://github.com/anthonykewl20/arxic/pull/418) as
`1e242d4bb5339622d6089fb2c3c185df0344c0da`, after the required `ci` check passed
on `56a01513f7005846a7cfe9270ccfc5fa02d8d6e4`. The linked slice summaries retain
their individual CI revisions and evidence. These merged slices do not complete
issue #402.

## Verification boundaries

The default-catalog implementation passed 48 web tests in 13 files (233.93 s).
Its final metadata follow-up passed the 11 catalog/provider/browser tests (7.00 s).
Other slice test revisions, timings, failures and CI records remain in their own
proof summaries rather than being retroactively attributed to a newer revision.

Actual Chromium, Next/Express reference apps, source scanning, compilation,
verification and isolated Mailpit execute in the web suite. Boundary model stubs
make UI assertions deterministic; they are not live subscription proof. Separate
native-account probes retain real inference successes and failures. Two public
OpenRouter catalog reads returned 418 IDs each without credentials or inference.

The run/review, session and default-catalog records contain 41 agent-inspected
capture-masked PNGs and five sanitized action timelines. Their hashes were
rechecked after commit. This is not human visual sign-off. No raw trace ZIPs or
credential caches are retained in these records.

## Release disposition

`VERSION` and all 30 non-fixture manifests remain `0.0.200`; displayed labels use
`v0.0.200`. The owner-defined minor increment is 100 and a patch increment is 1.
No tag or release has been published for this expanded web product.

Issue #402 remains in progress. The remaining feature/proof rows above and the
[human screenshot-inspection gate](../release-gates/screenshot-inspection.md) must
be satisfied before public release. The next implementation work is recurring
selected campaigns and their state/persona/flag scope, followed by authenticated
visual checkpoints and runtime/retention/server-distribution work.
