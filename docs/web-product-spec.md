# Arxic web product specification

Owner direction: 2026-09-05. Full-product tracker: [#402](https://github.com/anthonykewl20/arxic/issues/402).
Initial integrated workbench: [#401](https://github.com/anthonykewl20/arxic/issues/401).
Architecture: [ADR-009](adr/009-web-workbench.md).

## Product outcome

A self-hosted web application for developers and QA teams to discover frontend
business intent, run AI-assisted functional E2E, identify visual defects, compare
regressions, manage evidence and schedule repeat audits. It runs locally or on a
server. The dashboard is the primary management interface.

The user connects a project folder and a running test deployment, configures
scope and test personas, and reviews an evidence-linked coverage map. Coding
agents use repository structure, documentation, tests and observed behavior to
propose workflows. Browser execution records what actually happened. Independent
assertions and deterministic replay decide functional outcomes. Visual review
combines actual image comparison, observable layout/accessibility findings and
AI interpretation grounded in the permitted screenshots.

## Core user journeys

1. **Connect:** select a folder accessible to the Arxic host; identify repository,
   revision, frameworks, app entry points, deployment and prerequisites. A server
   can inspect its mounted folders, not arbitrary files on a remote browser's PC.
2. **Discover:** enumerate routes, components, controls, conditions, state changes,
   docs/spec requirements and existing tests. Cluster business capabilities and
   retain source references. Explain unsupported syntax, ignored files, dynamic
   routes and missing runtime access.
3. **Configure:** choose personas, flags, feature scope, viewports, fixture/reset
   strategy, action permissions, provider connection and provider-agnostic model ID,
   execution budgets and schedules. Model suggestions must not restrict custom IDs.
   Credentials use server-side secret references. Unknown or destructive actions
   require appropriate operator policy and isolated fixtures.
4. **Exercise:** explore the selected scope in real browsers; create/replay small
   workflows; inspect positive and negative behavior, loading/error/empty states,
   navigation and responsive layouts. Never infer a successful transition from
   the mere presence of a button or page.
5. **Review:** inspect expected/baseline/current images, difference regions,
   reproducible findings, agent reasoning, deterministic assertions and safe
   evidence. Approve intended visual changes explicitly. Rejected observations
   remain part of the audit history.
6. **Repeat:** run on demand or on a schedule; associate results with source,
   deployment and capture environment; preserve previous baselines and expose
   newly uncovered or regressed areas.
7. **Administer:** manage projects, access, schedules, runtime health, agent
   configuration, budgets, storage/retention and audit history. Local and server
   deployment have explicit trust and concurrency boundaries.

## Provider and interface requirements

Model IDs must be provider-agnostic and refreshed from the provider or its native
CLI metadata. Arxic must not ship fixed model catalogs or silently substitute a
model. Failures and stale fetch times stay visible; custom IDs remain available.
Subscription/account connections include Claude Pro/Max, Codex/ChatGPT, eligible
SuperGrok through OpenClaw, Kimi Coding, OpenCode Go, OpenRouter and extensible
operator profiles. Native tools own login and refresh; a listed model alone does
not establish account entitlement. Each claimed paid execution path needs live
account proof.

The target interface uses React and shadcn/ui, with a polished, compact visual
hierarchy inspired by Linear. The shell, overview, campaign history/details,
schedules, administration and Models & accounts implement that foundation.
Inventory, workflow selection, run details, model fields and image-review
presentation still require migration. The project form uses React markup but
retains its native dialog and existing submission actions.
Browser account-login flows, richer connection management and full paid-plan
coverage remain explicit follow-up work under #402.

## Completeness contract

The goal is exhaustive coverage **within a declared scope**. No tool can infer
all hidden business requirements from source alone. The product must expose:

- the finite inventoried denominator and evidence for each row;
- source-only hypotheses versus runtime observations;
- verified and contradicted workflow assertions from deterministic execution;
- missing requirements, unsupported frameworks, unreachable states, blocked
  personas/fixtures/flags, and untested viewport/action combinations;
- source revision and deployment identity, budgets/frontier stops and sampling;
- independent acceptance expectations versus characterization of current behavior.

A fully accounted-for inventory is not the same as fully verified business
coverage. The UI must not collapse those into one success percentage. An LLM may
never assign `verified` or decide that a visual difference is an accepted change.

## Implementation and gap matrix

| Capability                 | Implemented workbench (#401/#402)                                                                                                                                 | Full release requirement (#402)                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Local/server web dashboard | Implemented from source checkout; single administrator                                                                                                            | Clean-install server distribution and recovery proof                                                   |
| Project configuration      | Folder, target, visual settings, cron; guided provider/model/persona/secret-reference/budget/deployment settings or engine config path                            | Remaining worker/retention controls, richer fixture setup and safe runtime onboarding                  |
| Source discovery           | Route/domain inventory plus JS/TS/JSX/TSX frontend declarations and Markdown/text requirements; line/hash provenance, filtering and explicit file/runtime gaps    | Semantic intent synthesis, richer framework support and source-to-runtime campaign mapping             |
| AI-assisted E2E            | Guided on-demand campaigns: one serialized engine run per selected source row, full denominator, per-workflow verifier outcomes and restart/cancellation controls | Broader state/persona/flag campaigns, recurring campaigns and independent business acceptance criteria |
| Visual regression          | Stable anonymous viewport captures, explicit baseline approval, real pixel differences                                                                            | Authenticated workflow checkpoints, responsive/state coverage, reviewed baseline lifecycle             |
| Frontend findings          | Deterministic layout/error heuristics plus inspected-image AI hypotheses with bounded regions, reproduction, independent criterion/gap and model provenance       | Broader semantic evaluation, authenticated/state coverage and independent confirmation                 |
| Scheduling                 | Durable serialized UTC cron; pause/resume; missed-slot coalescing                                                                                                 | Campaign/worker coordination, notification and budget/retention policies                               |
| Administration             | Single admin sessions, folder allow-list, audit events, cancellation, protected baseline deletion                                                                 | Role model if multi-user is required; secrets management and operator controls                         |
| Evidence                   | Named images, hashes, privacy provenance and sanitized action timeline; existing engine receipts                                                                  | Full real-app campaign proof and required independent human release inspection                         |

## Release acceptance

The complete web product is not ready merely because the engine release audit or
the initial dashboard tests pass. #402 remains open until each requirement above
has its real-app proof. At minimum, demonstrate:

- a clean local/server install and ordinary browser onboarding;
- a nontrivial real frontend with authenticated, loading/error/empty and
  responsive states, plus a deliberately regressed variant;
- measured source/runtime/intent coverage with honest omissions;
- AI findings tied to actual pixels/source and deterministic reproductions;
- correct acceptance/rejection of functional and visual regressions;
- scheduled execution, interruption/restart, cancellation and access refusal;
- immutable baseline/history handling and safe artifact exports;
- current-head CI pass, license checks, docs and the human screenshot gate.

## Explicit initial assumptions

One trusted administrator operates each instance. Projects are already on the
host and test apps are already running. The initial web app does not clone remote
repositories, launch arbitrary project scripts, host multiple isolated tenants,
configure SSO, or send external notifications. These are implementation
boundaries, not claims that the broader product direction has been completed.
