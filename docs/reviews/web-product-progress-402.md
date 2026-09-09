# Web product progress and remaining release work — #402

This records the expanded web-product work for `v0.0.200`. It does not replace
the historical engine audit or establish readiness for the full public web release.
The acceptance contract remains [the web product specification](../web-product-spec.md).

## What the current application provides

| Requirement                    | Current behavior and evidence                                                                                                                                                                                                                                                                                                                                                                            | Remaining release work                                                                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local/server web application   | Source-checkout and compiled tarball installation (`arxic web`, refs #435), persistent SQLite, project roots, queued jobs, restart recovery and a token-authenticated administrator dashboard. [Installation proof](../evidence/WEB-402-INSTALL/summary.md).                                                                                                                                             | Broader deployment/runtime onboarding and release signoff.                                                                                                                                       |
| Polished React/shadcn frontend | Workspace shell, overview, inventory, selection, campaigns, run/capture review, model fields, schedules, administration and Models & accounts use React/shadcn. Existing shared API/form actions and native dialogs remain. [Workspace](../evidence/WEB-402-SHADCN/summary.md), [inventory](../evidence/WEB-402-INVENTORY-UI/summary.md), [run/review](../evidence/WEB-402-RUN-REVIEW/summary.md) proof. | Richer connection/account and runtime controls. A presentation migration does not complete the product feature matrix.                                                                           |
| Provider/model agnosticism     | No built-in model catalog. Named providers and configured default HTTP connections refresh provider-owned IDs, preserve custom input, disclose stale results and bind caches to accounts. [Catalog proof](../evidence/WEB-402-DEFAULT-CATALOG/summary.md).                                                                                                                                               | Opaque host/gateway defaults require an explicit named discovery adapter. Metadata does not establish execution entitlement.                                                                     |
| Subscription/account plans     | Native Claude/Codex/OpenCode bridges, OpenCode Go and Kimi/OpenRouter profiles, dedicated OpenClaw routing for eligible Grok accounts. Login remains owned by server-installed native tools. [Subscription proof](../evidence/WEB-402-SUBSCRIPTIONS/summary.md).                                                                                                                                         | Fresh paid Kimi/Go/SuperGrok/OpenRouter inference has not been validated. Browser account-login flows are not implemented.                                                                       |
| Deep frontend discovery        | Route/domain inventory, JS/TS/JSX/TSX declarations and documentation requirements with line/hash evidence, filters and explicit gaps.                                                                                                                                                                                                                                                                    | Semantic business-intent synthesis, more frameworks and source-to-runtime state mapping. Source declarations do not reveal every hidden requirement.                                             |
| AI functional campaigns        | Guided on-demand selection, one serialized engine run per selected source row, full denominator and deterministic per-workflow outcomes. Real Next/Mailpit workflows pass two verifier replays in retained tests.                                                                                                                                                                                        | Recurring selected campaigns, broader personas/flags/states and independent business acceptance criteria. Latest inventory/ledger views do not union all prior campaign outcomes.                |
| Real visual regression         | Stable path/viewport capture, sign-in with in-memory session state proven against a real hash-routed SPA: wrong passwords classify blocked with the retained engine error and exactly one bounded attempt ([koel login proof](../evidence/WEB-402-KOEL-LOGIN/summary.md)), explicit baseline approval, numeric evidence and pixel differences; image-grounded AI hypotheses preserve model provenance.   | Authenticated workflow/state exploration beyond configured logins, target-browser matrices, broader detector evaluation and reviewed baseline lifecycle.                                         |
| Scheduling/admin               | Durable UTC cron for individual runs, pause/resume, missed-slot coalescing, cancellation, root restrictions, audit history and opt-in protected evidence retention.                                                                                                                                                                                                                                      | Campaign/worker coordination, runtime management and applicable notification policies; storage quotas are discharged (#534) and the packed server/worker distribution proofs are recorded below. |
| Session/submission correctness | Draft consent is discarded on logout or session loss; pending submissions survive navigation; late responses cannot mutate a new session. [Session proof](../evidence/WEB-402-SESSIONS/summary.md).                                                                                                                                                                                                      | Broader adversarial testing as new actions and account flows are introduced.                                                                                                                     |

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
be satisfied before public release. Selected campaigns, explicitly configured authenticated checkpoint galleries
and project-configured browser sign-in against a third-party SPA (#538 koel
proof) are implemented, and the clean server distribution proof is recorded below.
Remaining work includes broader state/persona/flag coverage, provider
account-login flows (owner-blocked, see #538) and the human
release gate; the storage-quota row is discharged by the evidence disk quota
(#534).

## Dashboard production audit (2026-09-06)

[WEB-402-DASHBOARD proof](../evidence/WEB-402-DASHBOARD-UX/summary.md) covers bookmarkable section/run navigation, searchable complete history, responsive light/dark themes, keyboard/focus behavior, measurement evidence and failure recovery. The adopted local rewrite adds guided folder/GitHub connection and optional sign-in/link discovery. Unsafe unmasked video is refused; existing clone folders are not silently updated. The dashboard matrix is separate from the target application's still-incomplete visual-oracle/state matrix. Required CI and inspected evidence are recorded in the audit; this section does not declare the full product release-ready.

The contrast slice adds a bounded solid-paint text profile and screenshot-region lookup, including unavailable-paint reasons and image-load retry. This expands numeric auditing but leaves compositing, broader interaction states and other oracle families open. A full-suite reset-email discrepancy is tracked in [#422](https://github.com/anthonykewl20/arxic/issues/422); a passing focused rerun does not resolve it.

#422 follow-up reproduces the two-email discrepancy by delaying the first real replay submission. Generated replay now shares exploration's bounded action-settling service; the original count threshold remains and per-submission counts strengthen it. Current-head proof and CI are recorded in the issue/PR; full #402 readiness is not implied.

### Workflow checkpoint gallery (refs #427)

Explicit semantic workflow capture declarations now flow through guided dashboard
settings and the local/worker verifier policy. Successful verifier runs can expose
hash-checked checkpoint images and unchanged privacy provenance in Test runs.
Capture consent, unique regions and required masks remain mandatory; changed files
are unavailable with retry feedback. This closes the authenticated checkpoint
visibility gap for explicitly configured workflows, not general state exploration,
optical/heuristic completeness or the full cross-browser matrix. Evidence and CI
results are recorded in the WEB-427-CHECKPOINTS slice note.

### Clean server distribution proof (recorded 2026-09-09)

The packed distribution is exercised on every qualifying CI run, not by a one-off
record: the `package` job installs the packed CLI tarball into a temporary clean
room and runs the full installed-dashboard journey matrix against the packed
`arxic web` binary (`ARXIC_TEST_INSTALLED_WEB_BIN` via the shared
`startWorkbench` seam) — including the campaign journey that connects the real
reference-auth-app fixture, launches a real selected campaign and waits for the
real engine outcome (`2 verified` in the run detail), plus the retention and
restart journeys. `scripts/web-distribution-e2e.mjs` separately proves the
packed web command's refusal matrix (missing administrator token, missing
packaged assets, invalid configuration/corrupt assets), packaged-asset serving
and restart policy retention. The `worker-image` job builds the digest-pinned
worker image and runs the real-world sandbox suite against it when worker files
change. Green at head `699d3026` (run 34331173077, all 14 checks). Boundary:
this is the clean-install server/worker distribution proof; it is not a fresh
live-provider campaign, and the human screenshot-inspection gate stays owed.

### Captured element inspector (refs #429)

The dashboard now binds numeric element inspection to the retained screenshot:
point picking, keyboard ID search, pagination, parent navigation and existing
measurement references. Malformed/unstable/unbound geometry remains unavailable;
changed or symlinked original PNGs are refused. The desktop topbar scrolls normally
to avoid obscuring report actions. Check details use a keyboard-accessible disclosure
and search feedback stays above the input. [Proof](../evidence/WEB-429-ELEMENTS/summary.md)
records exact real-app geometry comparisons, light/dark desktop/mobile journeys and
remaining coverage. This is not semantic locator discovery or full heuristic certification.

### Evidence retention (refs #431)

Administration adds disabled-by-default age/newest retention, full-history previews,
explicit consent, protected bounded deletion and restart recovery. The new dashboard
flow covers settings/preview/storage failures and retry in light/dark and mobile
layouts. Real Chromium captures exercise cleanup while preserving original baseline
bytes; the database-scale supplement covers history beyond the 200-row state view.
The evidence disk quota (#534, `5551273e`) adds an opt-in `diskQuotaMb`
reclamation path: preview measures real evidence bytes (symlinks never followed),
quota candidates are exactly the too-young unprotected runs beyond `keepLatest`
(oldest-first, batch-capped), cleanup subtracts freed bytes while deleting and
reports `stillOverQuota` honestly when protection keeps storage over quota; proven
with real Chromium captures under 1.2 MB injected pressure and a byte-identical
surviving baseline (DISK-QUOTA-534 slice note). Campaign deletion and complete
runtime management remain unclaimed.

### Baseline history clarity (refs #433)

Capture results distinguish comparison status at capture time from current baseline
approval. Historical no-baseline and absent-difference states explain what happened
in that run; the current approval badge identifies the selection for future runs.
Real browser journeys cover approval failure/retry, replacement, revisiting history
and exact preservation of prior results and image bytes. This addresses the wording
ambiguity observed in #431's screenshots without changing comparison truth. Proof
and CI revisions are recorded in the WEB-433-BASELINE-HISTORY slice note.

## Captured-element browsing (refs #437)

Type filtering supplements screenshot picking and capture-local number search.
The retained projection contains bounded integer codes, with legacy unknown-kind
coverage and strict screenshot binding. It does not retain semantic names or produce
replay selectors, and it does not expand the set of hard visual predicates. Real
reference-app flows and the dashboard's own declared controls are the test inputs.

Browser/theme visual coverage now supports explicit Chromium/Firefox/WebKit ×
light/dark × configured viewport selections (refs #439). Per-environment outcomes,
shared-budget omissions and independent baselines prevent an absent cell from
becoming a pass. Real browser, authenticated reference-app and dashboard proofs
cover the named matrix. Zoom/locale/OS/device and broad interaction-state
coverage remain release gaps; #402 stays open.

### Capture gallery navigation (refs #441)

Run captures have combined path/environment/viewport/comparison filters, explicit
matching counts and six-capture pagination. Original evidence and baseline actions
retain their identity; environment coverage is never filtered. Real reference-app
matrix journeys test no matches, keyboard paging, polling, run changes and retained
baseline comparisons. This expands dashboard usability, not the oracle's detector
or state coverage. Proof and final CI are recorded in the WEB-441-GALLERY note.

## Dashboard readability follow-up (#445)

The dashboard contract adds real reference-project discovery and capture journeys
under user text spacing and 200% mounted HTML text enlargement, in light/dark.
It covers narrow navigation, run measurements, Administration, provider-name
recovery and keyboard scrolling of the model catalog. A deliberately clipped
login control guards the numeric detector. Sidebar rows, text buttons, run
headings and mobile activity/header groups now accommodate enlarged content.
All six source cases passed in Chromium, Firefox and WebKit; the
[retained evidence](../evidence/WEB-445-READABILITY/summary.md) records exact hashes,
negative guards and corrected screenshots. PR #446 merged as `94a9aa93` after
required CI 34076797886 passed on `8176dd4e`: 2,096 shard tests and all three
installed dashboard engines. The retained installed evidence contains 879 PNGs
and 78 sanitized timelines with matching hashes. Incomplete accessibility reports
remain unverified; native browser zoom, full locale/persona/state coverage and
human release inspection remain gaps.

Earlier installed runs exposed font-dependent clipping, a 1/65536 CSS-pixel
Firefox measurement difference and a lost bookmarked run after sign-in. The
merged change corrects layout and login restoration, declares measurement
resolution and retains deliberate clipping guards. These earlier failures and
probes remain in the evidence history. Generic WebKit navigation-error
classification is still under investigation in #447; no error exemption ships.

Dashboard validation follow-up: source CI 34075361763 retained five of six required healthy-page gallery captures. Per-cell failure evidence is now retained; the original cause remains tracked in [#448](https://github.com/anthonykewl20/arxic/issues/448), and a later local pass does not discharge it.

Capture failures now carry a bounded failed-operation diagnostic and grouped browser/page recovery guidance. Navigation and missing required-mask refusals have real six-cell matrix and desktop/mobile proof; the original five-of-six CI capture loss remains unresolved in #448. No raw errors, retries or privacy waivers are added.

Blocked visual runs link directly to their current project capture settings. The real recovery journey checks saving a corrected required mask, successful rerun and preservation of the original blocked snapshot; it is included in the shared installed-dashboard contract (24 tests /14 files).

Native 1×/2×/3× density selection extends that matrix in #454 / PR #455.
Native PNGs and baseline identities preserve density; the inspector retains CSS
coordinates. High-density Chromium uses explicitly identified full headless
rendering. Local native-repeat, authenticated eighteen-cell and responsive dashboard
proof passes; exact-head installed CI remains pending. See the
[density follow-up](../evidence/WEB-454-DENSITY/followup.md).

## Screenshot census — machine pre-pass (2026-09-09)

Every retained PNG under `docs/evidence/WEB-402-*` — **344 files** — was rendered
into 66 contact sheets and read, and the PNG/`.privacy.json` pairing was
machine-verified exhaustively: **344 PNGs, 344 provenance files, zero orphans in
either direction**. No credential, token, API key, session value or personal
datum was observed. Capture-time masking is visibly applied and consistent, and
secret configuration fields render environment-variable **reference names**, not
values.

Two non-credential findings were raised, both `observed`, both for owner
decision: the operator's absolute home path is rendered in the `WEB-402-INSTALL`
captures and the `WEB-402-DASHBOARD-UX` admin captures, and the same path appears
in 305 tracked files repo-wide. The four **source** literals that emitted it are
fixed and a guard test now rejects new ones; the already-published evidence and
doc occurrences are not rewritten. Full record:
[`WEB-402-CENSUS-PRESCREEN`](../evidence/WEB-402-CENSUS-PRESCREEN/summary.md).

**This does not discharge the human screenshot-inspection gate.** Per
`docs/release-gates/screenshot-inspection.md`, an LLM cannot; steps 2-6 remain
owed, and only the 344 `WEB-402-*` PNGs were pre-screened out of 1,460 in the
wider `docs/evidence/` tree.

## Tracker disposition (2026-09-09)

Issue #402 is closed as a work item. Every acceptance row it still carried that
is genuinely un-discharged is recorded, with who can discharge it and what would
count as proof, in
[`docs/release-gates/undischarged-gates.md`](../release-gates/undischarged-gates.md).
Closing the tracker authorizes no release tag or publication — unchanged from
while it was open.

## Clean-install fresh live-provider campaign acceptance — discharged (2026-09-09, #546)

The distribution-proof section above states its boundary verbatim: it is the
clean-install server/worker distribution proof, **not** a fresh live-provider
campaign. That boundary is now closed.

A packed `arxic-0.0.401.tgz` was clean-room-installed into an empty directory
with its own `HOME` and a fresh per-run SQLite. The funded credential was
**deleted from the server's environment before spawn** and reached the install
only through `POST /api/provider-secrets` — the same endpoint the Models &
accounts screen uses. One bounded campaign (single `GET /login` row,
per-pass-login persona, model `glm-4.7`, budget $0.025) reached
`result.outcome: "verified"`, with `ledger.verification` recording
`{"outcome":"verified","passedRuns":2,"runs":2}` — the replay count is measured,
not inferred. All thirteen executed engine stages completed; all eight gates
passed.

Sad path proven first: with no credential configured, the identical campaign on
the identical discovery settled `blocked`/`blocked`, stage 5 failing closed. The
runner asserts that a credential-less `verified` is a failure of the proof.

The credential was never retained — verified independently after the run, neither
the value nor any 8-character prefix appears in the record. Evidence and its
honest limits (one row is a path proof, not coverage):
[`WEB-402-CLEAN-INSTALL-LIVE`](../evidence/WEB-402-CLEAN-INSTALL-LIVE/summary.md).
Runner: `scripts/clean-install-live-campaign.mts`.
