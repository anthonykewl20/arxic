# ADR-009: Self-hosted frontend testing workbench

Date: 2026-09-05. Owner direction accepted; full product implementation remains
in progress (refs #402). Initial integrated workbench: refs #401.

## Decision

Arxic becomes a web application that can run on a developer workstation or a
server. Its primary interaction is a dashboard for project configuration,
frontend intent discovery, AI-assisted functional E2E, visual regression review,
schedules and administration. The existing CLI and worker remain execution
interfaces and reusable engine infrastructure.

The [product specification](../web-product-spec.md) defines the full target and
the implementation boundary. The older CLI release audit proves that engine
revision; it does not establish readiness for the expanded web product.

## Initial architecture

`apps/web` owns HTTP authentication, project policy, queue transitions, scheduling,
and baseline decisions. SQLite owns durable project/run records and the
administrator audit log. A filesystem lock enforces one server process per state
directory. The initial instance has one administrator; it is not multi-tenant.

Source discovery reuses `SourceUaAdapter` and Domain Inventory. AI E2E reuses the
existing CLI action and local executor, including its fixture, attestation,
model, compilation and verifier gates. The web action binds source and target to
the registered project and snapshots the validated configuration before running.
Guided project settings compose the same engine-owned configuration validator as
file-based execution. Model/fixture values are resolved from server secret names
only at child launch; project and run records retain reference names. Guided
jobs clear inherited persona credentials and remove generic secret-reference
variables before adding selected engine credentials. Missing references block
before launch. The action owns policy and failure classification; the existing
local executor remains the execution capability. Crawl/runtime limits are bounded;
model costs are estimates, not a guaranteed host-agent billing ceiling. Domain
and feature-flag declarations do not implement deployment toggles or campaign
route filters. Frozen evidence/workflow contracts are unchanged.

### Scoped engine execution (2026-09-05 continuation, refs #402)

The optional configuration field `scope.inventoryRowIds` passes through the
shared local/worker projection. The orchestrator validates current source rows
before inference, restricts proposals and re-proposals, and records selection
separately from the unchanged full inventory. Invalid or stale selections block
instead of running a default candidate. Selection participates in the persisted
input fingerprint. This is the prerequisite for campaign orchestration; one
engine run still compiles at most one candidate. No workflow or truth contract
changes and no LLM verification authority are introduced.

### Durable workflow campaigns (2026-09-05 continuation, refs #402)

The web action creates an immutable campaign record and one existing engine job
per selected source consumer row in a single SQLite transaction. Guided settings
and the discovered source commit bind every child; current source is checked
before enqueue and again before child launch. The existing serial queue owns
execution, fixture lifetime and restart handling. No separate execution engine
or LLM truth authority is added.

Campaign state is derived from referenced child records. Selected workflow
verification counts remain separate from unselected/non-proposable inventory and
uncompiled hypotheses. Cancellation records all unfinished children before
interrupting an active process. Referenced evidence cannot be deleted through
individual run deletion. This first campaign interface is on demand; cron still
schedules individual run modes. Retention, recurring campaigns and broader
business-state exploration remain release requirements.

### Frontend declaration inventory (2026-09-05 continuation, refs #402)

An additive source-adapter capability emits `arxic-frontend-inventory-v1` from
the existing hashed source manifest and native JS/TS/JSX/TSX parser. Bounded,
no-follow reads must match the indexed bytes. Component/control/action/state/
condition/test/configuration/flag declarations and Markdown/text requirements carry their
commit, path, line range and content hash. Unsupported, unsafe, malformed,
dirty, changed and truncated inputs remain explicit file gaps. Static rows
remain hypothesized; their count is never a runtime coverage percentage.
The web discovery result persists this inventory separately from route/domain
inventory and the existing AI ledger. Dashboard filtering/pagination and JSON
access expose the finite denominator and omissions. This addition does not
implement multi-workflow campaigns or semantic image review.

Jobs execute in separate child processes with bounded lifetime. The dashboard's
administrator token is excluded from job environments. This is process lifecycle
isolation, not a hostile-code security sandbox: mounted projects and configured
host agent tools are trusted operator inputs. Distributed/multi-tenant execution
requires a separate authorization and worker design.

## Visual review contract

The initial visual lane uses actual Chromium, fresh anonymous contexts, fixed
viewport/scale/locale/timezone/color scheme, and two consecutive identical
captures before accepting stability. It blocks service workers, WebSockets,
cross-origin requests and non-GET/HEAD requests. Network/script failures and
heuristic frontend findings remain visible. Only configured paths and visible
viewports are captured; this is not a full-page or authenticated-state campaign.

The administrator must authorize test-data capture. Inputs, textareas and
editable content are always masked; additional configured selectors must match
or the checkpoint is blocked. The shared screenshot-privacy service captures and validates canonical PNG bytes before retention. Each retained screenshot has adjacent provenance. These administrator-authorized viewport records are distinct from verifier-bound workflow attestations.
Only allow-listed action names, checkpoint ordinals and results enter the
timeline; raw traces are never recorded in this lane. These dashboard artifacts
are not promoted workflow bundles and cannot be used as verifier receipts.

Baseline identity binds origin, path, viewport, masks, Chromium version, platform
and capture policy. Approval is explicit and audited. Captures must be stable,
belong to a completed run, and match their recorded hash. Comparisons never
automatically replace baselines. Deletion refuses active runs and approved
baselines. Pixel differences report change, not independently proven business
defects. A human release screenshot inspection remains required by the charter.

## Truth and completeness

No new truth state is introduced. Source discovery is `hypothesized`; visual
observations and comparisons are `observed`; missing/unsafe prerequisites and
unstable captures are `blocked`. Only the existing deterministic verifier may
produce `verified` functional outcomes. The web layer displays that result rather
than manufacturing it.

“All frontend business logic” is a coverage objective, not a guarantee available
from a folder path. Scope includes source revision, deployment, routes,
components, states, personas, flags, inputs, actions and viewports. Gaps remain in
the denominator. Semantic AI image analysis and comprehensive multi-workflow
campaigns are required by #402. On-demand source-row campaigns now exist; broader
state/persona/flag exploration and broader semantic evaluation remain incomplete.

## Scheduling and deployment

Five-field cron expressions use UTC. The server coalesces missed slots into one
run, records a unique slot key, and serializes jobs. A paused project does not
enqueue scheduled jobs. Interrupted running records become blocked at restart;
queued jobs remain durable. There is no automatic retry of potentially mutating
AI workflows.

Local binding defaults to loopback. Remote binding requires an explicit HTTPS
public origin behind an operator-configured TLS reverse proxy. Sessions are
HTTP-only, same-site cookies; writes require the configured origin and JSON.
Folders are server-side, realpath-checked against configured roots. See the
[deployment guide](../web-workbench.md) for the exact supported setup.

## Version numbering

The owner requires `v0.0.NNN` release labels: a minor release adds 100 to the
counter (`v0.0.100` → `v0.0.200`); a patch adds 1. No counter digits are reset or
truncated. Labels pad to at least three counter digits and include `v`.

Current release line: **v0.0.200**. `VERSION`, package manifests and generated
machine provenance store npm-compatible `0.0.200`; CLI `--version`, dashboard
labels and Git tags use `v0.0.200`. For a counter below 100, the canonical numeric
form remains unpadded (`0.0.7`) and the label is `v0.0.007`. One shared policy
module formats labels and computes increments. Release automation and package
smoke tests check this mapping. `pnpm version:minor` and `pnpm version:patch`
update every non-fixture manifest together with `VERSION`.

This owner instruction supersedes the earlier pre-1.0 minor/patch cadence and
the earlier 0.1.0 target. Historical audit evidence is preserved under its original
version. No tag or publication is performed by this decision.

## 2026-09-05 image transport prerequisite

The local model-adapter API accepts optional integrity-checked PNG evidence.
HTTP uses ordered image content parts; explicitly configured host transports use
private temporary attachments with cleanup. Run records retain image hashes,
dimensions and byte counts. Existing text-only requests remain unchanged.

This is an additive local capability; the frozen contracts and truth-state
boundary are unchanged. The dashboard must separately authorize capture and
transmission, bind findings to image hashes and independently assess claims.
Transport success establishes delivery, not defect correctness or semantic
coverage. The dated dashboard review decision below supplies its first application flow; broader coverage remains under #402.

## 2026-09-05 inspected-image dashboard review

An on-demand `review` job binds administrator inspection/sharing attestation to
one stable retained screenshot hash. Queue and execution validate PNG/provenance;
source evidence is protected while referenced. Ordinary run/cron routes cannot
create reviews. The durable queue and restart/cancellation handling are reused,
with job-owned provider process groups and temporary attachment cleanup. Shared
secret resolution supplies only the chosen model credential to the review child.

AI output has no truth-state field. The application adds `hypothesized` to each
schema-validated proposed region, binds reproduction and administrator criteria,
and rejects out-of-image rectangles. Bounds are not semantic proof. No findings
means no hypotheses returned, not defect-free or complete coverage. Authenticated
states and broader comparative evaluation remain under #402.

## 2026-09-05 provider-agnostic model selection

Guided projects and image reviews optionally persist a named model connection
ID alongside the requested model ID. Connections are operator-owned environment
configuration, not arbitrary browser-supplied endpoints or commands. The web
service exposes only labels, transport and model suggestions; the action resolves
one job's credentials and rates and clears inherited settings from other profiles.
Unknown profiles and absent HTTP pricing block before provider contact.

Both controls allow custom model IDs. The existing compatible HTTP transport
passes the exact ID; named host profiles require explicit `{model}` forwarding
through separate argv. Legacy server-default host behavior remains available with
its selection limitation disclosed. Suggested models do not prove availability,
image capability or underlying provider identity. Frozen engine contracts and
truth-state rules are unchanged; this is additive web configuration and transport
argument handling, not native support for all provider protocols.

## 2026-09-06 provider-owned catalogs and native account connections

This supersedes operator model suggestions as an availability source. Model
catalogs are fetched from compatible provider APIs or installed native CLI
metadata, with no baked-in model IDs. Operator model entries supply rate overrides
only. The action deduplicates refreshes, tracks freshness/failure, invalidates API
catalogs when credentials change, and binds the exact requested ID without
fallback. Provider metadata may supply rates; absent API rates still block
inference. A catalog does not establish account entitlement or image capability.

Native Claude/Codex/OpenCode bridges use account login owned by the installed CLI;
Arxic does not read credential caches. Subscription preflight rejects API-key
login for Claude/Codex. Native prompts/schema envelopes travel over stdin,
private working directories and attachments are supervised, and native structured
output still passes the adapter's existing schema gate. OpenClaw has a dedicated
agent/body route and explicit backend-model header; internal tool restrictions
remain part of that gateway agent's operator configuration.

The first React/shadcn screen is Models & accounts. Local Vite bundling serves
self-contained assets, and the remaining screens migrate incrementally. The
[retained proof](../evidence/WEB-402-SUBSCRIPTIONS/summary.md) preserves native
account successes, schema failures, clean-screen false positives and the explicitly
disclosed lexical-oracle correction. No expanded product release or complete paid
provider matrix is established by this addition.

## 2026-09-06 workspace presentation migration

The React/shadcn foundation now renders the workspace shell, overview, campaign
history/details, schedules and administrator activity. Compact neutral surfaces
and responsive navigation apply across the workbench. Mobile navigation is an
inline disclosure, with Escape returning focus to its toggle. Existing action
handlers continue to own requests, session invalidation, polling and mutations;
presentation components consume server state without assigning verifier outcomes.
The project form is React-rendered with a native dialog and existing form actions.
Inventory, selection, run details, model controls and image review remain explicit
migration work. See the [browser proof](../evidence/WEB-402-SHADCN/summary.md).

## 2026-09-06 inventory presentation and source evidence

Intent inventory, source declarations and workflow selection now render through
React/shadcn. Source inventory and intent-ledger rows are projected separately:
ledger evidence references are nested under `evidence`, not at the source-row
root. Mobile surface rows use labeled stacked fields so reference columns remain
visible. Workflow and declaration components use distinct discovery-bound keys;
a background discovery cannot retain old checked inputs or duplicate forms.
Existing action handlers retain selection limits, requests and session protection.
Persisted inventory/ledger fields remain typed views at the UI boundary; this
change does not add a browser schema validator or union outcomes across runs.
See [inventory browser proof](../evidence/WEB-402-INVENTORY-UI/summary.md).

## 2026-09-06 run and review presentation

Run lists, capture comparisons, image hypotheses and provider/model fields now
render through React/shadcn. Shared model controls subscribe to provider metadata
while retaining editable custom IDs. Review forms own pending and draft state;
a submission disables its settings and captures consent for the exact image.
The action layer owns enqueue requests, session-epoch checks and navigation to
the accepted run before refreshing its state. Logout unmounts component roots
and clears unsent review drafts. Run details honor the selected project filter.
Server policy and deterministic truth-state assignment remain unchanged.

See [run/review browser proof](../evidence/WEB-402-RUN-REVIEW/summary.md).

## 2026-09-06 dashboard session and request state

A shared pending-request registry uses per-request tokens so presentation remounts
cannot re-enable duplicate review or campaign submissions. Clearing a session
invalidates these tokens; an old completion cannot release a newer request with
the same key. The action layer applies session-epoch validation to all API responses
before callers can navigate or mutate current dashboard state. Explicit logout
and unauthorized responses share one cleanup path for drafts, consent, selections,
model metadata and mounted project controls. Already accepted server jobs continue
to be retained; rejecting a stale browser response does not cancel a server job.

See [session and pending-request proof](../evidence/WEB-402-SESSIONS/summary.md).

## 2026-09-06 default-provider catalog discovery

Configured server-default HTTP connections use the same bounded metadata fetch,
account-sensitive cache, failure sanitization and five-minute refresh policy as
named providers. The default refresh route has no provider-ID path segment; this
preserves the existing empty default ID without reserving an operator profile name.
Public state exposes only model IDs and catalog status, never endpoints or keys.
Opaque host/gateway defaults do not infer a native catalog adapter; they explain
the limitation and allow choosing a named provider. Models & accounts includes
the configured default catalog while retaining existing named-provider ordering.
Execution pricing and entitlement policies are unchanged by metadata discovery.

See [default-provider browser and live proof](../evidence/WEB-402-DEFAULT-CATALOG/summary.md).

## 2026-09-06: measured visual evidence foundation

The [visual-oracle contract](../visual-oracle.md) defines the owner-requested full
auditor scope. New visual captures add a bounded numeric-only scene projection
and hash-linked assessment artifact. Capture mechanics collect observations;
the assessment action owns predicate classification independently of model
output. The existing document-overflow check now uses this single assessment
predicate. Unavailable detector families remain unverified and cannot establish
a whole-audit pass. Engine truth states and frozen contracts are unchanged.
The current screenshot-review model still emits separate hypotheses; full
scene-bound model fusion and expanded capture matrices are future slices.

## 2026-09-06: solid text contrast and region inspection

The numeric scene now includes a bounded, text-free solid-paint projection.
Pure assessment predicates compare unrounded ratios against explicit thresholds;
unsupported paint stays unverified. The dashboard searches measured checks and
locates their numeric regions on the retained masked capture, with native image
readiness and recoverable load failures. Capture identity and engine truth states
remain unchanged. This is a scoped profile, not whole-page accessibility
certification. See the [contrast contract](../visual-oracle.md#solid-text-contrast-profile)
and [real reference-app and dashboard proof](../evidence/WEB-402-CONTRAST/summary.md).

## 2026-09-06: asynchronous replay completion

A real selected-reset run exposed premature replay completion: pathname and heading assertions could already hold while the submitted request was pending. Delaying only the first replay by 800 ms reproduced two emails despite two passing replay reports; the browser closed the delayed request before it reached the real app. Exploration already waited for completion.

Generated replays now use the same bounded network/render settling service before assertions, screenshots and receipts. The service's constant package-owned source also keeps runtime bytes stable across source execution and bundling. It is emitted in the existing transition runtime, preserving independent source/hash verification and compile-policy boundaries. No model decides completion, no locator gate is widened, and engine truth contracts are unchanged.

The regression preserves the original minimum-three-email assertion and additionally checks each accepted submission's inbox count (1, 2, 3) against real Next.js and isolated Mailpit. This establishes the delayed-request failure mechanism; the original historical request timing was not retained. Full #402 production scope remains separate.

### 2026-09-06 — Explicit workflow checkpoint captures (refs #427)

The app-local CLI/worker policy now accepts an optional `checkpointCapture`
declaration using the existing screenshot privacy contract. CLI and worker share
validation/policy construction; neither invents approval metadata from model output.
Guided dashboard settings require operator capture consent and carry the declaration
into the execution snapshot. File-config execution applies the same consent gate.

A separate `workflowCaptures` result exposes only verifier-attested screenshots from
a successful promoted run. Export revalidates the complete artifact set and bound
source, confines reads to that run's engine directory, and copies image/provenance
bytes under an explicit original-name mapping. Requests reject altered or nonregular
files. Export failures remain explicit evidence gaps while retaining the deterministic
engine verdict. This gallery has no baseline approval action and makes no complete
visual-audit claim. Frozen workflow truth contracts remain unchanged.

## 2026-09-07: opt-in evidence retention (refs #431)

A persisted administrator policy controls age/newest retention and is disabled
by default. The action layer validates explicit deletion consent, streams whole
history eligibility and applies bounded cleanup only while execution is idle.
A single reference projection serves manual deletion and retention, protecting
current/historical baseline evidence, review sources and campaign sources/children.
SQLite mechanics live in the retention repository; eligibility and failure
classification remain actions.

Deletion persists an intent before removing files and then deletes the run record
and intent in one database transaction. Failed filesystem cleanup stays visible;
startup resumes authorized intents before any jobs execute. A later policy disable
stops new selection but does not revoke already authorized deletion. The dashboard
previews bounded candidate details with complete counts and explains this recovery
boundary. Disk quotas, SQLite compaction and campaign removal are outside this slice.

## 2026-09-07: Installed web distribution (refs #435)

The CLI package now exposes `arxic web`. Packaging compiles a separate web-job
entrypoint and builds the React/Tailwind frontend once. Runtime startup reads a
bounded manifest and checks hashes for the index, JS, CSS and compiled job before
opening the state store or listener. The manifest detects incomplete/corrupt local
installation; it is not a signed supply-chain attestation. Source execution retains
its Vite builder behind a source-only dynamic import. Build-time runtime selection
cannot be changed through an environment variable.

The existing source dashboard E2E assertions can launch the installed public command
outside the repository. The packaging gate reuses its clean install for startup,
source discovery, visual baseline/element inspection, responsive navigation, real
reference-app campaigns and restart/deletion-recovery assertions. Model proposals
remain boundary stubs in campaign proof; source analysis, browser actions, compiler,
verifier and Mailpit are real. Safe named screenshots and sanitized timelines are
retained; no raw trace archive is exported. Release publication and human screenshot
inspection remain separate gates.

## 2026-09-07: Bounded element-kind browsing (refs #437)

VisualScene schema 1 gains the optional `kindSchemaVersion: 1` projection with
per-node integer kind codes 0–9. The browser derives them from a fixed recognized-role
lookup (precedence over native defaults) or native element type. Unknown strings
never leave the browser; host validation/reprojection retains only the bounded code.
The 2000-node budget and original numeric IDs remain unchanged. No raw roles, labels,
field values, URLs or selectors are retained. This is an inspection hint, not an
accessibility-role oracle or replay locator.

The inspector requires supported versioned kinds when that projection is present;
legacy numeric-only scenes remain valid with unknown kinds. Existing screenshot
hash/viewport and numeric bounds checks remain mandatory. Browsing metadata does not
participate in hard-solver validity, so it cannot waive a measured overflow failure.
Type filters combine with number or point selection; filter changes reset selection
and pagination, and parent navigation clears filters before revealing the parent.

Proof uses actual reference-app captures in both themes, narrow/wide dashboard
layouts, and actual dashboard native/declared controls. Historical metadata is an
explicit response-format boundary supplement over unchanged real capture geometry
and pixels. The installed-browser packaging gate runs these assertions too.

### 2026-09-07 — explicit visual environment matrix (refs #439)

Project admission accepts bounded, distinct browser and color-scheme selections;
legacy projects default to Chromium/light. Capture orchestration expands the
browser/theme × viewport matrix, divides the 600-checkpoint budget across it and
keeps each environment’s failure visible. Per-environment authentication uses its
own browser/session. The existing capture mechanics, privacy masks, read-only
network policy, stable scene checks and hard assessment predicates apply unchanged.
Baselines bind engine and theme; legacy Chromium/light spec identity is preserved.

Browser-generated sRGB and full-precision sBIT PNG markers are validated and removed
only in the application-owned viewport capture helper. No encoded pixel chunk is
changed. The strict retained validator still rejects ancillary chunks. This is not
a change to verifier attestation or generated screenshot policy.

Real reference-app tests exercise all three engines and both themes, independent
baseline histories, a dark-only regression, authenticated Next.js capture and
explicit missing-engine boundary failure. Dashboard journeys configure and inspect
the matrix in both themes and four widths; installed-package CI runs those GUI
journeys. DPR/zoom/locale/direction/forced-color and arbitrary workflow-state
coverage remain open. Engine WebKit is not real-device Safari certification.

### 2026-09-07 — native pixel density and run-local authentication (refs #454)

The matrix additionally accepts native 1×/2×/3× density with a shared 600-checkpoint
budget and a 16-megapixel per-capture admission bound. Missing density preserves
legacy 1× identities. Screenshot pixels retain native resolution; scene boxes and
point selection remain CSS coordinates. AI overlays use image dimensions, and the
unchanged model image bound produces an actionable refusal when exceeded.

Native Chromium 2×/3× uses Playwright's full Chromium headless channel after real
reference-app probes reproduced two shell text rasters across fresh captures. The
renderer is explicit in environment/baseline identity; an unavailable full browser
blocks the cell rather than falling back. This does not assert cross-OS parity.

Superseding the prior per-environment sign-in bootstrap, each browser family signs
in once through the real form per run. Its result remains in memory for that run
only; later cells record explicit reuse. This avoids matrix expansion exhausting
the target's login rate limit. A fresh invalid-credential run must block every
cell with zero captures, even after a successful run. No session state is persisted.
Capture contexts and their privacy/read-only guards remain independent. This is
authenticated capture coverage, not independent login-state coverage in every cell.

[Local proof](../evidence/WEB-454-DENSITY/followup.md) retains red and green evidence;
required exact-head CI and installed acceptance remain pending for PR #455.
