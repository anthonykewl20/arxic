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
campaigns are required by #402 and are not implemented by the initial workbench.

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
