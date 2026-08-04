# ADR-001: Arxic — Evidence-Driven Behavioral Intent Compiler for Playwright

| Field | Value |
|---|---|
| Status | Proposed |
| Decision date | 2026-08-04 |
| Owners | Arxic maintainers |
| Scope | Initial architecture, reuse strategy, contracts, security model, and authentication vertical slice |
| First supported ecosystem | TypeScript/JavaScript; React, Next.js, Express; Chromium |
| Primary output | Independently replayable Playwright workflow bundles with screenshots, traces, provenance, and coverage status |
| Research basis | Upstream repositories and documentation pinned in the Source Ledger |

## 1. Decision

Build Arxic as a hybrid, evidence-driven compiler rather than as a source-code crawler or a free-form browser agent.

Arxic will assemble proven open-source capabilities at their public or deliberately vendored seams:

1. Understand Anything contributes deterministic repository scanning, Tree-sitter structure extraction, import-graph batching, merge, and fingerprint concepts.
2. ast-grep contributes framework-specific, testable structural rules for routes, forms, guards, validators, auth configuration, mail flows, and MFA code.
3. Crawlee contributes bounded breadth discovery, URL queues, retries, sessions, and browser surface collection.
4. Playwright contributes browser execution, accessibility snapshots, semantic locators, planner/generator/healer agent capabilities, test execution, screenshots, video, and traces.
5. LangGraph.js contributes resumable orchestration, checkpoints, retries, deterministic/agentic step composition, and human interrupts.
6. Graphology contributes the in-memory evidence and coverage graph.
7. AJV plus selected Archify patterns contribute strict schema validation, stable diagnostics, pinned source provenance, hashes, and atomic bundle promotion.
8. Testcontainers, Mailpit, and otplib contribute isolated test dependencies for authentication workflows.

Arxic itself will own only the glue that is specific to its product:

- canonical evidence and workflow contracts;
- source/runtime adapters;
- framework rule packs;
- confidence and status transitions;
- coverage reconciliation;
- safety and healing policies;
- bundle compilation and quality gates;
- incremental invalidation;
- provenance and licensing records.

This is a capability-level assembly. Arxic will not fork any candidate application wholesale.

## 2. Blunt feasibility finding

No tool can reliably recover the “full business intent” of an arbitrary repository from source alone.

Relevant behavior may depend on feature flags, database state, hosted identity providers, secrets, runtime configuration, background jobs, external email/SMS, dead code, tenant policy, or undocumented operational rules. A source-only system can find evidence and propose likely flows; it cannot prove that those flows exist or behave as inferred.

Arxic therefore uses five truth states:

| State | Meaning | Who may assign it |
|---|---|---|
| hypothesized | Suggested by source, docs, or a model, but not observed at runtime | Static analyzers or model |
| observed | A runtime surface/action was seen, but the expected business outcome was not fully proved | Runtime collector |
| verified | Preconditions, actions, assertions, and expected state transition passed in a replayable Playwright run | Deterministic verifier only |
| contradicted | Runtime evidence disproved the candidate or source evidence conflicts | Reconciler/verifier |
| blocked | Verification could not safely proceed because a fixture, account, feature flag, environment, or approval was missing | Orchestrator/verifier |

An LLM may create or refine hypotheses. It may never assign verified.

“Complete” will mean complete within an explicit scope matrix: configured repositories, commit, deployment, personas, feature flags, browsers, routes, and allowed actions. Arxic must report uncovered and blocked candidates; it must never silently equate passed tests with full feature coverage.

## 3. Context and problem

The intended user experience is:

1. Point Arxic at a project and a safe test deployment.
2. Let it discover behavioral capabilities such as login, invalid login, forgot-password, reset-password, change-password, MFA enrollment/challenge/recovery, logout, and session invalidation.
3. Receive small, consumable Playwright workflow bundles rather than one opaque generated suite.
4. Inspect the source and runtime evidence behind every generated action and assertion.
5. Replay the bundle and receive deterministic screenshots, traces, reports, and a clear list of gaps.

Existing projects solve substantial parts of this problem, but none of the inspected projects provides the complete evidence-to-verified-workflow pipeline:

- Understand Anything builds a useful structural and domain-oriented knowledge graph, but its domain extraction is still inference and its lightweight fallback samples a limited amount of source.
- Archify provides strong typed-IR, diagnostic, repository-evidence, and atomic-delivery patterns, but its workflow schema describes diagrams rather than executable business behavior.
- Playwright already provides most of the runtime planning, generation, healing, locator, screenshot, and trace machinery.
- Crawlee is strong at breadth discovery and session-aware crawling, but breadth crawling is not safe workflow verification.
- Agentic browser tools can explore interfaces but do not provide Arxic’s source provenance, completeness model, or deterministic promotion gate.

The architecture must connect these gears without binding Arxic to their internal representations.

## 4. Decision drivers

The design is ranked by these drivers:

1. Evidence and reproducibility over plausible output.
2. Reuse proven engines instead of rebuilding parsers, crawlers, browsers, test runners, or orchestration.
3. Public APIs or process boundaries over imports from unstable internals.
4. Small replaceable adapters over a monolithic fork.
5. Safe execution of untrusted repositories and web content.
6. Explicit blocked/uncovered reporting.
7. Incremental operation on changing repositories.
8. License compatibility and traceable vendoring.
9. Human-readable plans and machine-readable contracts.
10. A narrow, demonstrable first vertical slice.

## 5. Scope

### 5.1 In scope for the first release

- A local CLI and isolated worker.
- One repository at a pinned Git commit.
- TypeScript and JavaScript projects.
- React, Next.js, and Express rule packs.
- Chromium execution.
- Local, preview, or dedicated test deployments only.
- Authentication as the reference domain.
- Static evidence, runtime exploration, Playwright generation, replay verification, screenshots, traces, and bundle packaging.
- Incremental analysis based on source fingerprints and graph impact.

### 5.2 Explicit non-goals

- Running against production by default.
- Proving requirements that are absent from both source and observable behavior.
- Fully autonomous destructive workflows.
- Replacing product requirements, security testing, or human QA.
- Supporting every language and UI framework in the first release.
- Importing private Playwright modules as stable APIs.
- Using screenshots alone as the primary element model.
- Creating one giant test suite whose scenarios share mutable state.

## 6. Capability assembly ledger

The commit pins are research snapshots, not release versions. Implementation must pin released packages and container digests in lockfiles, while contract tests verify the capabilities listed here.

| Gear | Capability borrowed | Exact seam | Consumption mode | License | Decision |
|---|---|---|---|---|---|
| Understand Anything | Git-aware scanning, ignores, language/category detection, Tree-sitter extraction, import communities, fingerprints | scan-project.mjs, extract-structure.mjs, extract-structure-result.mjs, compute-batches.mjs, TreeSitterPlugin, TypeScript extractor, framework registry | Vendor a reviewed, minimal subset or maintain an MIT-preserving fork behind SourceIndexer; do not import its UI/agent application | MIT | Adopt selected deterministic pieces |
| ast-grep | AST pattern matching, relational rules, JSON stream output, rule tests | sg scan with versioned YAML rule directories; optional @ast-grep/napi only where process startup is material | Public CLI process boundary first | MIT | Adopt |
| Graphology | Typed graph container and graph algorithms used by the indexing family | Graph, traversal, shortest paths; Louvain package where needed | npm public packages | MIT | Adopt |
| Crawlee | URL/request queues, BFS/DFS, retry policy, browser sessions, routing, bounded concurrency | PlaywrightCrawler, RequestQueue, SessionPool, Router | npm public APIs | Apache-2.0 | Adopt for breadth discovery only |
| Playwright Test | Browser automation, semantic locators, codegen, runner, assertions, screenshots, traces, auth state | @playwright/test public API; CLI; generated agent configuration | npm/CLI public surfaces | Apache-2.0 | Adopt |
| Playwright Test Agents | Planner, generator, execution journal, healer behavior | init-agents plus a PlaywrightAgentAdapter around the current test MCP server process | Process boundary with version contract test; never import packages/playwright/src internals | Apache-2.0 | Adopt behind adapter |
| Playwright MCP | Accessibility snapshots and constrained browser tools | @playwright/mcp configuration/connection surface or Playwright-managed process | Public package/process boundary; origin and tool allowlists enforced outside it | Apache-2.0 | Adopt selectively |
| LangGraph.js | Durable workflow execution, checkpoints, retry, interrupt, deterministic plus agentic nodes | StateGraph and checkpointer interfaces | npm public package | MIT | Adopt |
| AJV | JSON Schema 2020-12 validation | compiled validators and strict mode | npm public package | MIT | Adopt |
| Archify | Stable diagnostics, source evidence discipline, path/SHA validation, hash receipts, last-good atomic promotion | validator.mjs, repository-evidence.mjs, delivery-contract.md concepts | Adapt small MIT modules/patterns into Arxic contracts; retain copyright and notices | MIT | Adopt patterns and reviewed code |
| Testcontainers for Node | Throwaway dependent services, networks, health/wait strategies | GenericContainer, Network, wait strategies | npm public API | MIT | Adopt |
| Mailpit | Captured email and REST search/delete API for reset flows | Pinned container image plus REST API | Container/process boundary | MIT | Adopt for isolated test environments |
| otplib | RFC-compatible HOTP/TOTP generation for test personas | Authenticator/HOTP/TOTP public API | npm public package, pinned major | MIT | Adopt |
| Midscene | Visual/semantic fallback for canvas, non-DOM, or inaccessible widgets | Playwright integration and AI query/assert actions | Optional adapter; findings remain observed until Playwright assertions verify them | MIT | Defer to optional extension |

### 6.1 Evaluated but not selected as core

| Candidate | Finding | Decision |
|---|---|---|
| Archify workflow schema | Models presentation nodes and edges, not executable preconditions, transitions, assertions, or runtime evidence | Do not reuse as the workflow IR |
| Understand Anything domain-agent output | Useful candidate generator, but model-derived domain/flow/step results are not runtime proof | Use as hypotheses only |
| Stagehand | Capable agentic act/extract/observe system, but its current engine and abstraction overlap Playwright and introduce another browser control plane | Optional future planner adapter, not core |
| TestZeus Hercules | Strong Gherkin/report/proof concepts, but AGPL-3.0 code creates a material distribution/SaaS licensing decision | Do not copy or link code unless Arxic deliberately adopts AGPL obligations |
| Browser-use | Adds a Python browser-agent stack that duplicates the chosen Playwright execution plane | Reject for MVP |
| SCIP/scip-typescript | Can improve cross-file symbol precision but adds indexer/toolchain cost before the TypeScript vertical slice proves a gap | Defer as SourceIndexer extension |
| XState graph/test packages | Useful state-model concepts, but no compelling current capability gap after LangGraph plus Graphology | Defer |
| Regex-only route/domain discovery | Cheap, but fragile for aliases, composition, decorators, JSX, and framework conventions | Use only as a labeled fallback, never primary evidence |

## 7. Reuse boundaries and exact upstream references

### 7.1 Understand Anything

Use these deterministic pieces as the starting source adapter:

- understand-anything-plugin/skills/understand/scan-project.mjs
- understand-anything-plugin/skills/understand/extract-structure.mjs
- understand-anything-plugin/skills/understand/extract-structure-result.mjs
- understand-anything-plugin/skills/understand/compute-batches.mjs
- understand-anything-plugin/packages/core/src/plugins/tree-sitter-plugin.ts
- understand-anything-plugin/packages/core/src/plugins/extractors/typescript-extractor.ts
- understand-anything-plugin/packages/core/src/languages/framework-registry.ts
- framework hints for Next.js and Express

Do not rely on understand-domain as a verifier. Its domain analyzer and lightweight context extractor are useful hypothesis producers, but sampled/regex context cannot establish full intent.

Tree-sitter grammar licenses must be checked separately from the parent project license.

### 7.2 Archify

Port or adapt these behaviors:

- validate all output through a compiled JSON Schema;
- emit stable diagnostics containing code, severity, subject, evidence, and supported fixes;
- require canonical origin, full 40-character commit SHA, normalized relative path, and verified line range for source links;
- freeze output bytes before validation;
- stage a private same-directory snapshot;
- validate and hash the staged bytes;
- atomically replace the public bundle only after every gate passes;
- preserve the last-known-good output on failure;
- issue a receipt with SHA-256 and byte counts.

Do not port its diagram workflow schema into Arxic.

### 7.3 Playwright

Use public @playwright/test APIs for generated suites, fixtures, projects, storage state, traces, screenshots, and reports.

Use current Playwright Test Agent behavior through an adapter:

- planner explores the application and writes a human-readable plan;
- generator executes plan steps against a live app and records generated Playwright code;
- verifier runs the staged suite;
- healer may repair mechanical locator/timing drift under Arxic policy.

The current Playwright source contains plannerTools.ts, generatorTools.ts, testTools.ts, testContext.ts, testBackend.ts, seed.ts, and agent prompt files under packages/playwright/src. These are audit references, not import targets. The current run-test-mcp-server command is an internal/hidden CLI seam, so PlaywrightAgentAdapter must:

1. pin a tested Playwright version;
2. start the process without shell interpolation;
3. perform a startup capability handshake;
4. translate Arxic contracts to the agent interface;
5. fail closed if required tools or schemas change;
6. provide a direct @playwright/test generator fallback;
7. be covered by upgrade contract tests.

The upstream healer prompt allows test.fixme when it believes the application is broken. Arxic overrides that behavior: fixme, skip, only, weakened assertions, deleted assertions, and success-by-quarantine are never accepted as a successful heal.

### 7.4 Crawlee

Crawlee collects surfaces, not business truth. It may:

- enumerate allowed routes;
- record titles, forms, accessible controls, links, and navigation edges;
- keep bounded session pools;
- retry transient navigation failures;
- prioritize requests using a queue;
- respect per-origin concurrency and configured budgets.

It may not:

- submit destructive forms without an approved action policy;
- infer a verified state transition from page presence;
- parallelize workflows that share mutable identities;
- leave configured origins;
- create an unbounded crawl frontier.

## 8. System architecture

~~~mermaid
flowchart TD
    A["Pinned source + isolated test deployment"] --> B["Static evidence plane"]
    A --> C["Runtime discovery plane"]
    B --> D["Canonical evidence graph"]
    C --> D
    D --> E["Workflow hypotheses + coverage matrix"]
    E --> F["Playwright plan, generate, replay"]
    F --> G{"Deterministic quality gates"}
    G -- Pass --> H["Atomic workflow bundles"]
    G -- Not proven --> I["Blocked, contradicted, or flaky report"]
~~~

The diagram below is the canonical end-to-end architecture and pipeline view. It spans inputs, LangGraph orchestration, the static and runtime planes, targeted Playwright exploration, deterministic verification with constrained healing, evidence-gated atomic promotion, and incremental reruns. It is the single source of truth for stage wiring, decision points, and disposition routing.

~~~mermaid
flowchart TD
    subgraph INPUTS["1. Inputs"]
        SRC["Pinned Git repository"]
        CFG["Arxic scope and policy"]
        TARGET["Local, test, or preview deployment"]
        MODEL["User-selected LLM endpoint"]
    end

    MODEL --> MAD["ModelAdapter: credentials, structured output, tool calls"]

    subgraph ORCH["LangGraph run orchestration: state, checkpoints, retries, and interrupts"]
        direction TB

        subgraph PREFLIGHT["2. Preflight and isolation"]
            REV["Resolve full commit SHA and file manifest"]
            ATTEST["Validate target, environment, origins, and action policy"]
            SAFE{"Target approved and reachable?"}
            STOP["Stop run with blocking diagnostics"]
            WORKER["Create ephemeral non-root worker and isolated network"]

            REV --> ATTEST
            ATTEST --> SAFE
            SAFE -- No --> STOP
            SAFE -- Yes --> WORKER
        end

        subgraph STATIC["3. Static evidence plane"]
            direction TB

            SCAN["Understand Anything scanner and Tree-sitter extraction"]
            RULES["ast-grep framework rule packs"]
            DOCS["Parse OpenAPI, route manifests, docs, and existing tests"]
            SEVENTS["Normalize source evidence events"]
            EGRAPH["Graphology evidence graph"]
            NEIGHBOR["Build bounded evidence neighborhoods"]
            INFER["LLM: infer behavioral candidates"]
            HYP["Hypothesized workflows"]

            SCAN --> SEVENTS
            RULES --> SEVENTS
            DOCS --> SEVENTS
            SEVENTS --> EGRAPH
            EGRAPH --> NEIGHBOR
            NEIGHBOR --> INFER
            INFER --> HYP
        end

        subgraph BREADTH["4. Runtime breadth discovery"]
            direction TB

            BOOT["EnvironmentAdapter builds and starts application"]
            DEPS["Provision Testcontainers, Mailpit, personas, and OTP support"]
            CRAWL["Crawlee RequestQueue and SessionPool"]
            SURFACES["Collect URLs, forms, controls, accessibility, navigation, and network evidence"]
            OBS["Observed runtime surfaces"]

            BOOT --> DEPS
            DEPS --> CRAWL
            CRAWL --> SURFACES
            SURFACES --> OBS
        end

        subgraph RECON["5. Evidence reconciliation and coverage"]
            direction TB

            MERGE["Reconcile source evidence and runtime observations"]
            MATRIX["Create domain, persona, state, flag, and browser coverage matrix"]
            SELECT{"In-scope candidate available?"}
            PRECOND{"Safe fixtures and preconditions available?"}
            BLOCKED["Mark workflow blocked with exact reason"]
            LEASE["Lease and reset disposable persona fixtures"]
            DISPOSITION["Record blocked, contradicted, flaky, and uncovered dispositions"]

            MERGE --> MATRIX
            MATRIX --> SELECT
            SELECT -- No --> DISPOSITION
            SELECT -- Yes --> PRECOND
            PRECOND -- No --> BLOCKED
            BLOCKED --> DISPOSITION
            PRECOND -- Yes --> LEASE
        end

        subgraph TARGETED["6. Targeted Playwright exploration"]
            direction TB

            PLAN["LLM plus Playwright planner: create an intent plan"]
            ACTION["Policy engine checks origin and action class"]
            AUTHZ{"Action decision"}
            HUMAN["Human approval for privileged or external effects"]
            EXPLORE["Playwright executes safe actions and records journal"]
            TEVID["Capture targeted runtime evidence"]
            COMPLETE{"Required transitions observed?"}
            BUDGET{"Exploration budget remains?"}
            WIR["Normalize canonical Workflow IR"]
            GENERATE["LLM plus Playwright generator: compile test"]
            STAGE["Stage plan, fixtures, spec, and screenshot checkpoints"]

            LEASE --> PLAN
            PLAN --> ACTION
            ACTION --> AUTHZ

            AUTHZ -- Read-only or leased mutation --> EXPLORE
            AUTHZ -- Approval required --> HUMAN
            AUTHZ -- Forbidden --> BLOCKED

            HUMAN -- Approved --> EXPLORE
            HUMAN -- Denied --> BLOCKED

            EXPLORE --> TEVID
            TEVID --> COMPLETE
            COMPLETE -- Yes --> WIR
            COMPLETE -- No --> BUDGET
            BUDGET -- Yes --> PLAN
            BUDGET -- No --> BLOCKED

            WIR --> GENERATE
            GENERATE --> STAGE
        end

        subgraph VERIFY["7. Deterministic compilation and verification"]
            direction TB

            SCHEMA["AJV schema validation and TypeScript compilation"]
            CPASS{"Schema and compilation pass?"}
            POLICY["AST policy, origin, assertion, and secret scan"]
            PPASS{"Generated test policy passes?"}
            REPLAY["Run Playwright from clean fixture state"]
            ARTIFACTS["Capture named screenshots, trace, network, console, and report"]
            EXPECTED{"Expected state transitions pass?"}
            RUNCOUNT{"Required clean runs completed?"}
            RESET["Reset leased fixtures"]
            CLASSIFY["Classify failure from deterministic evidence"]
            FAILURE{"Failure category"}
            HEALBUDGET{"Constrained heal budget remains?"}
            HEAL["LLM proposes mechanical repair"]
            DIFF["Semantic diff: actions, assertions, locators, and evidence"]
            PRESERVE{"Business intent and assertions preserved?"}
            REJECT["Reject repair and keep workflow unverified"]
            CONTRADICTED["Mark candidate contradicted"]
            FLAKY["Mark workflow flaky"]
            VERIFIED["Mark workflow verified"]

            STAGE --> SCHEMA
            SCHEMA --> CPASS
            CPASS -- No --> CLASSIFY
            CPASS -- Yes --> POLICY
            POLICY --> PPASS
            PPASS -- No --> REJECT
            PPASS -- Yes --> REPLAY

            REPLAY --> ARTIFACTS
            ARTIFACTS --> EXPECTED

            EXPECTED -- Yes --> RUNCOUNT
            RUNCOUNT -- No --> RESET
            RESET --> REPLAY
            RUNCOUNT -- Yes --> VERIFIED

            EXPECTED -- No --> CLASSIFY
            CLASSIFY --> FAILURE

            FAILURE -- Mechanical test drift --> HEALBUDGET
            FAILURE -- Application contradicts candidate --> CONTRADICTED
            FAILURE -- Missing fixture or dependency --> BLOCKED
            FAILURE -- Nondeterministic result --> FLAKY

            HEALBUDGET -- No --> REJECT
            HEALBUDGET -- Yes --> HEAL
            HEAL --> DIFF
            DIFF --> PRESERVE
            PRESERVE -- No --> REJECT
            PRESERVE -- Yes --> STAGE

            REJECT --> DISPOSITION
            CONTRADICTED --> DISPOSITION
            FLAKY --> DISPOSITION
        end

        subgraph PROMOTION["8. Evidence gates and atomic publication"]
            direction TB

            EVIDGATE["Check every transition and assertion has valid evidence"]
            EVIDPASS{"Evidence complete?"}
            FREEZE["Freeze staged bundle bytes"]
            META["Generate hashes, provenance, SBOM, licenses, and NOTICE"]
            PROMOTE["Atomically promote while preserving lastknown-good bundle"]
            BUNDLE["Verified Playwright workflow bundle"]
            COVERAGE["Domain coverage and blocker report"]
            DOMAINPACK["Consumable domain pack"]

            VERIFIED --> EVIDGATE
            EVIDGATE --> EVIDPASS
            EVIDPASS -- No --> BLOCKED
            EVIDPASS -- Yes --> FREEZE
            FREEZE --> META
            META --> PROMOTE
            PROMOTE --> BUNDLE

            DISPOSITION --> COVERAGE
            BUNDLE --> DOMAINPACK
            COVERAGE --> DOMAINPACK
        end
    end

    SRC --> REV
    CFG --> ATTEST
    TARGET --> ATTEST

    REV --> SCAN
    REV --> RULES
    REV --> DOCS

    WORKER --> BOOT
    WORKER --> SCAN

    MAD --> INFER
    MAD --> PLAN
    MAD --> GENERATE
    MAD --> HEAL

    HYP --> MERGE
    EGRAPH --> MERGE
    OBS --> MERGE
    TEVID --> EGRAPH

    subgraph INCREMENTAL["9. Incremental reruns"]
        NEW["New commit, application build, or feature flags"]
        IMPACT["Compare hashes and traverse graph impact"]
        INVALIDATE["Invalidate affected evidence, candidates, and bundles"]
        REUSE["Reuse unaffected deterministic artifacts"]

        NEW --> IMPACT
        IMPACT --> INVALIDATE
        IMPACT --> REUSE
        INVALIDATE --> REV
    end

    DOMAINPACK --> CACHE["Content-addressed artifact cache"]
    CACHE --> IMPACT
~~~

### 8.1 Control plane

LangGraph owns the run state machine and persists a checkpoint after every stage. It passes immutable artifact identifiers between nodes rather than large mutable objects.

Recommended state:

~~~ts
type RunState = {
  runId: string;
  sourceRevision: SourceRevision;
  environmentId: string;
  scope: ScopeMatrix;
  artifactRefs: ArtifactRef[];
  candidateIds: string[];
  activeWorkflowId?: string;
  gateResults: GateResult[];
  status: "queued" | "running" | "awaiting-approval" |
          "completed" | "partial" | "failed";
};
~~~

### 8.2 Static evidence plane

The static plane performs deterministic scanning first:

1. Resolve the repository to a full commit SHA.
2. Enumerate tracked files and apply gitignore plus Arxic ignores.
3. Hash files and detect language/category.
4. Parse supported code using Tree-sitter.
5. Extract symbols, imports, exports, calls, endpoints, services, config, tests, and resource definitions.
6. Execute ast-grep rule packs for framework behavior.
7. Parse OpenAPI, route manifests, environment templates, existing Playwright/Cypress tests, and relevant documentation.
8. Normalize all findings into evidence events.
9. Build an import and behavior graph.
10. Batch bounded graph neighborhoods for optional model inference.

The model sees the smallest evidence neighborhood necessary. Source content is data, not instructions.

### 8.3 Runtime discovery plane

Runtime discovery has two distinct modes:

- Breadth mode uses Crawlee to map safe reachable surfaces and navigation edges.
- Intent mode uses Playwright to execute a particular candidate workflow with a persona, fixtures, and expected transitions.

Keeping these modes separate prevents a parallel crawler from corrupting user state or accidentally treating a URL inventory as a verified workflow.

### 8.4 Evidence and coverage plane

Graphology holds the active graph. Durable artifacts are content-addressed JSON/JSONL files; an embedded SQLite catalog may index runs and hashes, but it is not the canonical source of a bundle.

Core node kinds:

- Repository, Revision, File, Symbol, Config, Route, Endpoint;
- UI surface, Control, Persona, Fixture, State, Action, Assertion;
- Workflow, Plan, Test, Run, Screenshot, Trace, Network exchange;
- Feature flag, External dependency, Blocker, Diagnostic.

Core edge kinds:

- defines, imports, calls, renders, handles, guards, validates;
- links-to, submits-to, invokes, requires, transitions-to;
- emits, receives, proves, supports, contradicts, blocks;
- generated-from, exercised-by, captured-in, impacted-by.

All graph edges that influence output carry one or more evidence references.

### 8.5 Compilation and verification plane

A compiler turns a normalized workflow into:

- a human-readable plan;
- Playwright fixtures and projects;
- one or more independent spec files;
- explicit screenshot checkpoints;
- metadata assertions;
- expected artifact policy.

Generated files are written to a staging directory. They do not become consumable until all deterministic gates pass.

## 9. Pipeline

| Stage | Borrowed engine | Arxic input | Output | Failure behavior |
|---|---|---|---|---|
| 0. Target attestation | Testcontainers/environment adapter | Source ref, target URL, policy | Pinned revision and safe environment receipt | Stop if target is unapproved or looks like production |
| 1. Repository inventory | UA scanner concepts/code | Read-only checkout | File manifest, hashes, languages | Emit unsupported-language gaps |
| 2. Structural extraction | Tree-sitter via UA adapter | Changed source files | Symbols/imports/calls/routes | Retain parse diagnostics; do not invent facts |
| 3. Framework extraction | ast-grep | Versioned rule packs | Auth/routes/forms/guards/validators evidence | Rule tests must pass; low-precision fallback is labeled |
| 4. Candidate inference | LangGraph model node | Bounded evidence neighborhoods | Hypothesized workflows and assertions | Structured-output failure retries; no status promotion |
| 5. Breadth discovery | Crawlee | Seed URLs, personas, budgets | Surface/navigation graph | Frontier limits and origin policy terminate safely |
| 6. Reconciliation | Graphology | Static and runtime evidence | Coverage matrix, prioritized candidates | Conflicts become contradicted diagnostics |
| 7. Fixture preparation | Testcontainers/Mailpit/otplib/adapters | Workflow preconditions | Disposable persona and dependency handles | Missing safe fixture marks workflow blocked |
| 8. Intent exploration | Playwright planner/MCP | Candidate, persona, allowlist | Observed steps, snapshots, runtime evidence | Unsafe action pauses or blocks |
| 9. Compilation | Playwright generator + Arxic compiler | Normalized workflow and observations | Staged plan/spec/fixtures | Invalid/unsupported steps remain uncompiled |
| 10. Verification | Playwright runner | Staged suite | Results, screenshots, traces, reports | Failure invokes constrained diagnosis |
| 11. Healing | Playwright healer under Arxic policy | Failure and evidence | Candidate patch | Assertion weakening/quarantine is rejected |
| 12. Promotion | AJV + Archify delivery pattern | Staged bundle | Atomic signed/hash receipt | Last known good remains untouched |

## 10. Canonical contracts

### 10.1 Source revision

~~~json
{
  "repository": "https://github.com/example/shop",
  "commit": "40-character-full-sha",
  "dirty": false,
  "submodules": [
    {
      "path": "packages/idp",
      "repository": "https://github.com/example/idp",
      "commit": "40-character-full-sha"
    }
  ]
}
~~~

Dirty working trees may be analyzed, but Arxic must create a content manifest and must not manufacture GitHub blob links for uncommitted bytes.

### 10.2 Evidence reference

~~~ts
type EvidenceRef =
  | {
      kind: "source";
      repo: string;
      commit: string;
      path: string;
      startLine: number;
      endLine: number;
      blobSha256: string;
      extractor: string;
      ruleId?: string;
    }
  | {
      kind: "runtime";
      runId: string;
      appBuildDigest: string;
      browser: string;
      browserVersion: string;
      url: string;
      timestamp: string;
      accessibilitySnapshotSha256?: string;
      screenshotRef?: string;
      traceRef?: string;
      networkRefs?: string[];
    }
  | {
      kind: "document";
      artifactRef: string;
      section?: string;
      sha256: string;
    };
~~~

### 10.3 Workflow IR

The workflow IR represents business behavior, not Playwright syntax.

~~~json
{
  "$schema": "https://arxic.dev/schemas/workflow/v1.json",
  "id": "auth.password-reset.request",
  "version": 1,
  "title": "Request a password reset",
  "domain": "authentication",
  "persona": "registered-user",
  "status": "verified",
  "confidence": 1.0,
  "scope": {
    "commit": "40-character-full-sha",
    "environment": "local-test",
    "browser": "chromium",
    "featureFlags": ["password-reset=true"]
  },
  "preconditions": [
    {"fixture": "user.exists", "parameters": {"emailRef": "persona.email"}},
    {"fixture": "mailbox.empty", "parameters": {"inboxRef": "persona.inbox"}}
  ],
  "states": [
    {"id": "login-page"},
    {"id": "reset-request-form"},
    {"id": "reset-request-accepted"},
    {"id": "reset-email-received"}
  ],
  "transitions": [
    {
      "from": "login-page",
      "to": "reset-request-form",
      "action": {"intent": "Open the forgot-password form"},
      "assertions": [{"intent": "Reset request form is available"}],
      "evidenceRefs": ["src:forgot-link", "run:forgot-link"]
    },
    {
      "from": "reset-request-form",
      "to": "reset-request-accepted",
      "action": {
        "intent": "Submit the registered email",
        "inputRefs": {"email": "persona.email"}
      },
      "assertions": [
        {"intent": "A non-enumerating acceptance message is shown"}
      ],
      "evidenceRefs": ["src:reset-handler", "run:reset-submit"]
    },
    {
      "from": "reset-request-accepted",
      "to": "reset-email-received",
      "action": {"intent": "Read the test inbox through InboxAdapter"},
      "assertions": [{"intent": "Exactly one valid reset message arrives"}],
      "evidenceRefs": ["src:mailer", "run:mailpit-message"]
    }
  ],
  "negativeCases": [
    {
      "id": "unknown-email",
      "expected": "The public response does not disclose account existence"
    }
  ],
  "verification": {
    "requiredRuns": 2,
    "screenshotCheckpoints": [
      "reset-request-form",
      "reset-request-accepted"
    ],
    "trace": "retain",
    "forbidNetworkErrors": true
  },
  "evidenceRefs": [
    "src:forgot-link",
    "src:reset-handler",
    "src:mailer",
    "run:forgot-link",
    "run:reset-submit",
    "run:mailpit-message"
  ]
}
~~~

Important contract rules:

- Intent text is stable; locator syntax is a compiled implementation detail.
- Every transition has an action or a system event plus assertions.
- Every assertion has evidence or is explicitly labeled a proposed requirement.
- A workflow cannot be verified when any required transition is only hypothesized.
- Confidence is descriptive, not a substitute for status.
- Feature flags, persona, build digest, browser, and environment are part of scope.

### 10.4 Diagnostics

~~~json
{
  "code": "ARXIC-RUNTIME-004",
  "severity": "blocked",
  "subject": "auth.mfa.enroll",
  "message": "No safe test fixture can provision an MFA-capable user.",
  "evidenceRefs": ["src:mfa-controller", "config:idp-provider"],
  "supportedFixes": [
    "Configure PersonaProvisioner",
    "Provide a disposable seeded account"
  ]
}
~~~

Diagnostic codes and ordering are stable API. Messages may improve without breaking consumers.

### 10.5 Adapter contracts

~~~ts
interface SourceIndexer {
  index(input: SourceIndexRequest): AsyncIterable<EvidenceEvent>;
}

interface SurfaceDiscoverer {
  discover(input: DiscoveryRequest): AsyncIterable<EvidenceEvent>;
}

interface FixtureProvider {
  supports(requirement: FixtureRequirement): boolean;
  provision(requirement: FixtureRequirement): Promise<FixtureLease>;
  reset(lease: FixtureLease): Promise<void>;
  release(lease: FixtureLease): Promise<void>;
}

interface WorkflowPlanner {
  plan(candidate: WorkflowCandidate, context: RuntimeContext): Promise<PlanResult>;
}

interface WorkflowCompiler {
  compile(workflow: Workflow, observations: EvidenceRef[]): Promise<StagedBundle>;
}

interface WorkflowVerifier {
  verify(bundle: StagedBundle, policy: VerificationPolicy): Promise<VerificationResult>;
}

interface BundlePromoter {
  promote(bundle: StagedBundle, gates: GateResult[]): Promise<PromotionReceipt>;
}
~~~

Adapters return contracts, not upstream-specific objects. This makes Crawlee, Playwright agents, a direct generator, or a future vision observer replaceable.

## 11. Coverage model

Arxic reports coverage across a matrix rather than a single percentage.

Dimensions:

- source revision and application build;
- domain and feature;
- persona/role;
- route or entry point;
- precondition state;
- happy, negative, edge, and recovery path;
- configured feature flags;
- browser/project;
- static evidence status;
- runtime reachability;
- verification status;
- blocker reason.

Recommended summary measures:

- Candidate accountability = candidates with verified, contradicted, or blocked disposition / all in-scope candidates.
- Verified transition coverage = verified transitions / all reachable in-scope transitions.
- Source evidence coverage = generated workflow elements with source evidence / all generated workflow elements.
- Runtime evidence coverage = required workflow elements with runtime evidence / all required workflow elements.

A high candidate-accountability score can coexist with a lower verified score; that is useful because it exposes exactly what the environment prevents Arxic from testing.

The denominator is frozen in manifest.json for each run. New candidates discovered later produce a new manifest rather than rewriting history.

## 12. Authentication vertical slice

Authentication is not one workflow. It is a domain pack containing independently runnable workflow bundles.

### 12.1 Candidate inventory

Arxic searches for evidence of:

- login success;
- invalid credentials;
- disabled or locked account;
- logout and session invalidation;
- forgot-password request;
- valid, invalid, reused, and expired reset token;
- change-password with current-password verification;
- forced password change;
- MFA enrollment;
- MFA challenge;
- invalid/expired TOTP;
- recovery code use;
- remembered device;
- session expiry and reauthentication;
- hosted identity-provider redirects;
- role or tenant-specific authentication paths.

It emits only evidenced candidates. A conventional route name alone is not enough to claim a feature.

### 12.2 Static evidence examples

The Next.js/React/Express rule packs should identify and connect:

- route/page definitions and links;
- forms and submitted fields;
- client validation;
- server handlers/controllers;
- auth middleware and guards;
- password hash/compare calls;
- token creation, persistence, expiry, and single-use checks;
- mail template and mail transport calls;
- TOTP enrollment/verification and recovery-code logic;
- session cookie creation/destruction;
- existing unit, integration, Cypress, and Playwright tests;
- feature flags and environment requirements.

Each ast-grep rule has:

- stable rule ID and semantic version;
- supported framework/version range;
- positive and negative fixtures;
- expected extracted fields;
- precision notes;
- source license and provenance;
- a fallback diagnostic when syntax is unsupported.

### 12.3 Runtime fixtures

Authentication requires explicit fixture capabilities:

| Need | Adapter | Rule |
|---|---|---|
| Create/reset test users | PersonaProvisioner | Must use application-supported API/seed path; never manipulate an unknown production database |
| Capture reset email | InboxAdapter backed by Mailpit | Mailpit stays on the isolated worker network |
| Generate TOTP | OtpAdapter backed by otplib | Secret remains an opaque fixture value and is redacted |
| Hosted IdP | IdentityProviderAdapter | Use a dedicated test tenant and accounts |
| Feature flags | FeatureFlagAdapter | Record exact flag snapshot in scope |
| Time-dependent expiry | ClockAdapter where application permits | Otherwise wait-free token fixtures or mark slow/blocked |

If a required adapter is unavailable, the workflow is blocked. The generator must not fake inbox receipt, MFA success, or session invalidation.

### 12.4 Example emitted domain pack

~~~text
authentication/
  domain-manifest.json
  coverage-matrix.json
  login-success/
  login-invalid-credentials/
  password-reset-request/
  password-reset-complete/
  password-change/
  mfa-enrollment/
  mfa-challenge/
  logout/
~~~

Only verified bundles appear as executable releases. Hypothesized, contradicted, and blocked entries remain in the domain coverage report with their evidence and diagnostics.

## 13. Playwright compilation rules

Generated Playwright follows these rules:

1. Prefer getByRole, getByLabel, getByPlaceholder, getByText, and getByTestId in that order when semantically appropriate.
2. Use a CSS or XPath locator only with a diagnostic explaining why semantic location was impossible.
3. Assertions describe user-visible outcomes or externally observable state.
4. Do not use waitForTimeout.
5. Do not use arbitrary waitForLoadState as a substitute for a business assertion.
6. Avoid page.evaluate unless a reviewed adapter requires it.
7. Never embed plaintext secrets or real user data.
8. Use setup projects and storageState only when the workflow precondition allows a pre-authenticated session.
9. Keep state-mutating workflows serial per persona lease.
10. Capture named screenshots at workflow checkpoints and associate each with the transition ID.
11. Retain trace and report metadata according to bundle policy.
12. Keep tests independent; reset or release all fixtures.

### 13.1 Healing policy

Allowed healing:

- replace a locator with another locator that targets the same evidenced control;
- update a route when source and runtime evidence agree;
- repair deterministic readiness conditions;
- update generated fixture plumbing without changing the business assertion.

Forbidden healing:

- test.skip, test.fixme, test.only, describe.skip, or equivalent;
- deleting or weakening an assertion;
- changing expected business outcomes merely to match current behavior;
- swallowing exceptions;
- increasing timeouts repeatedly;
- adding broad force clicks;
- accepting console/network errors without policy;
- crossing the origin/action boundary;
- changing production source.

Every heal produces a semantic diff: actions added/removed, assertions added/removed/changed, locators changed, evidence changed, and status impact. A deterministic policy checker must approve the diff before replay.

## 14. Bundle contract

One bundle is one independently replayable workflow.

~~~text
arxic-bundle/
  manifest.json
  workflow.json
  plan.md
  tests/
    workflow.spec.ts
  fixtures/
    workflow.fixture.ts
  evidence/
    index.json
    source.json
    runtime.json
  artifacts/
    screenshots/
    traces/
    reports/
  provenance.json
  NOTICE
  checksums.sha256
~~~

manifest.json includes:

- schema and bundle versions;
- workflow ID and status;
- repository and full commit;
- application build digest;
- environment class, flags, persona type, browser/version;
- generator and model identifiers;
- exact dependency/package/container versions;
- verification runs and timestamps;
- file hashes;
- gate results;
- known blockers and unsupported scope;
- parent domain-pack/run IDs.

Screenshots and traces are immutable evidence artifacts. Sensitive headers, inputs, cookies, tokens, email contents, and PII must be redacted or access-controlled before promotion.

## 15. Quality gates

Promotion requires all mandatory gates:

| Gate | Requirement |
|---|---|
| Schema | Every JSON artifact validates in AJV strict mode against a pinned schema |
| Provenance | Every source link resolves to the pinned commit/path/range or is labeled uncommitted content |
| Compilation | TypeScript compiles and Playwright lists the generated test |
| Policy | No skip/fixme/only, assertion weakening, forbidden APIs, unsafe origins, or embedded secrets |
| Fixture lifecycle | Provision, reset, and release behavior succeeds without leakage |
| Execution | Required runs pass from clean fixture state; default MVP requirement is two consecutive passes |
| Evidence | Every required transition has runtime evidence; every generated claim has evidence references |
| Artifact | Required screenshots, traces, and reports exist and hashes match |
| Network/console | Errors satisfy the explicit workflow policy; unexpected failures block promotion |
| Coverage | Candidate disposition and uncovered/blocked matrix are present |
| Delivery | Staged bytes are frozen, hashed, and atomically promoted; last known good remains recoverable |

One pass and one failure is flaky, not verified. An application defect produces contradicted or blocked output, not a “fixed” test that hides the defect.

## 16. Security architecture

Arxic executes untrusted repositories and reads adversarial web content. Both are hostile inputs.

### 16.1 Isolation

- Run each analysis/execution job in an ephemeral non-root worker.
- Mount the source read-only.
- Keep generated files and downloads in a job-scoped writable directory.
- Do not mount host credentials, home directories, SSH agents, cloud metadata, or a general Docker socket into the browser worker.
- Place the app, browser, Mailpit, and test dependencies on a job-scoped network.
- Deny outbound network by default; allow only declared origins and package acquisition during a separate build phase.
- Enforce CPU, memory, process, file-size, run-time, URL-frontier, and artifact quotas.
- Destroy fixture leases and worker storage on completion according to retention policy.

Testcontainers may orchestrate dependencies from a trusted control worker, but the untrusted application/browser process must not receive unrestricted control of the container daemon.

### 16.2 Test-target attestation

The default policy refuses production-looking targets. A target must satisfy configuration and an environment handshake, for example:

- exact allowed origin;
- TLS/host validation where relevant;
- environment class local/test/preview;
- an Arxic test-target nonce or signed build receipt;
- application build digest;
- explicit destructive-action policy.

An override is a recorded human approval, never an LLM decision.

### 16.3 Prompt injection

Repository comments, documentation, issue text, page content, accessibility snapshots, emails, and network payloads are data. They cannot change system policy or authorize tools.

Agent nodes receive:

- a fixed task and structured evidence subset;
- an explicit tool allowlist;
- exact origin and action constraints;
- no general shell;
- no arbitrary filesystem read;
- no secret values unless a narrowly scoped action requires them;
- structured output validated before any subsequent action.

The policy engine, not the model, authorizes navigation, form submission, fixture changes, file writes, and promotion.

### 16.4 Action classes

| Class | Examples | Default |
|---|---|---|
| Read-only | Navigate, inspect DOM/accessibility, query isolated inbox | Allowed within budget and origin |
| Reversible mutation | Create disposable user, change disposable user password | Allowed only with a leased fixture and reset path |
| External side effect | Send SMS/email outside the test sink, create billing object | Blocked unless a dedicated sandbox adapter and policy exist |
| Destructive/privileged | Delete tenant, transfer funds, change administrator policy | Human approval plus dedicated disposable environment; otherwise blocked |

### 16.5 Secrets and privacy

- Contracts contain secret references, never secret values.
- Inject values at the last responsible adapter boundary.
- Redact DOM values, logs, traces, screenshots, network bodies, and model prompts.
- Detect common credential and PII patterns before promotion.
- Mailpit is a test sink, not a production mail proxy.
- Model-provider retention, regional processing, and source-sharing choices are deployment policy and must be recorded in the run.

## 17. Incremental operation

Cache keys include:

- repository commit and file hash;
- extractor and rule-pack version;
- Tree-sitter grammar version;
- framework detection result;
- model/prompt/schema version for inferred artifacts;
- environment build digest and feature flags for runtime artifacts;
- browser and Playwright version;
- persona/fixture recipe version.

Change impact:

1. Re-index changed files.
2. Invalidate symbols and evidence emitted by those files.
3. Traverse imports/calls/routes/config and generated-from edges.
4. Invalidate affected candidates, plans, and bundles.
5. Reuse unaffected verified bundles only when runtime scope is unchanged.
6. Mark reused artifacts with their originating run and cache proof.

Runtime evidence must not be reused across a changed application build unless a configured equivalence rule can prove the affected surface is unchanged. The conservative default is to replay.

## 18. Repository layout

~~~text
arxic/
  apps/
    cli/
    worker/
  packages/
    contracts/
    orchestrator-langgraph/
    source-ua-adapter/
    ast-grep-adapter/
    crawlee-adapter/
    playwright-agent-adapter/
    playwright-compiler/
    evidence-graph/
    reconciler/
    verifier/
    bundle-promoter/
    environment/
    fixture-mailpit/
    fixture-otplib/
  rulepacks/
    nextjs/
    react/
    express/
  schemas/
    evidence/
    workflow/
    manifest/
    diagnostics/
  third_party/
    understand-anything/
    archify/
  test-fixtures/
    vulnerable-auth-app/
    reference-auth-app/
  docs/
    adr/
    threat-model/
  LICENSES/
  NOTICE
~~~

third_party contains only reviewed vendored code, upstream license text, original commit, modification log, and automated parity/contract tests. If the selected UA and Archify pieces are reimplemented from documented behavior rather than copied, their source inspiration still belongs in provenance, but copyright notices must accurately reflect what is distributed.

## 19. Configuration

~~~yaml
version: 1

source:
  repository: .
  revision: HEAD
  languages: [typescript, javascript]

scope:
  domains: [authentication]
  frameworks: [nextjs, react, express]
  browsers: [chromium]
  personas: [anonymous, registered-user]
  featureFlags:
    password-reset: true
    mfa: true

target:
  origin: http://app.arxic.test
  environmentClass: local-test
  attestationPath: /.well-known/arxic-test-target.json
  allowedOrigins:
    - http://app.arxic.test
    - http://mailpit.arxic.test

policy:
  maxUrls: 250
  maxDepth: 8
  maxRuntimeMinutes: 30
  mutation: leased-fixtures-only
  externalNetwork: deny
  requiredVerificationRuns: 2
  screenshots: transition-checkpoints
  trace: retain
  humanApproval:
    - destructive
    - external-side-effect

fixtures:
  inbox: mailpit
  otp: otplib
  personaProvisioner: app-seed-api

models:
  provider: configured-adapter
  sourceRetention: disabled
~~~

## 20. Operational model

Start as a local CLI plus ephemeral workers, not a multi-tenant SaaS.

Reasons:

- it minimizes the initial secret and source-code trust boundary;
- it makes local test deployments and Docker Compose applications accessible;
- it allows contract, fixture, and evidence semantics to stabilize before adding tenancy;
- it avoids prematurely designing scheduling, billing, tenant isolation, and long-term artifact retention.

The CLI submits a run spec, streams stable diagnostics, and returns a run directory or promoted domain pack. A later service can reuse the same worker protocol and content-addressed artifacts.

### 20.1 Observability

Record:

- stage start/end and checkpoint;
- input/output artifact hashes;
- tool name/version and adapter version;
- model request ID, schema version, token/cost metadata without secret prompt content;
- browser/run ID;
- fixture lease lifecycle;
- decisions and approvals;
- quality gate results;
- redaction results.

Never use raw model prose as the only audit record.

## 21. Non-functional targets

These are initial engineering targets to validate in the reference repositories, not claims about the upstream projects:

- deterministic static output: identical input commit and tool versions produce byte-identical normalized evidence before timestamped packaging;
- resumability: a worker restart loses at most the active stage;
- isolation: no job can read another job’s source, secrets, fixtures, or artifacts;
- promotion integrity: a failed run cannot corrupt the last-known-good bundle;
- inspectability: every generated transition and assertion resolves to evidence;
- replacement: each borrowed engine can be swapped through one adapter contract;
- bounded work: crawl, model, execution, and artifact budgets are explicit and enforceable;
- incremental effectiveness: a small source change should avoid re-parsing unaffected files and re-inferencing unaffected graph neighborhoods.

Performance budgets must be benchmarked on small, medium, and large reference repositories before numerical SLOs are accepted.

## 22. Implementation milestones

### Milestone 0 — contracts and spikes

- Freeze EvidenceRef, Workflow v1, diagnostics, and manifest schemas.
- Build license/SBOM automation.
- Prove UA subset extraction on reference TypeScript repositories.
- Prove ast-grep rule fixtures for one Next.js and one Express auth implementation.
- Prove PlaywrightAgentAdapter handshake and fallback generator.
- Prove atomic promotion and last-known-good recovery.
- Threat-model the worker and create the target-attestation check.

Exit: one manually supplied login candidate compiles, verifies twice, and promotes with evidence.

### Milestone 1 — authentication vertical slice

- Static inventory and evidence graph.
- Next.js/React/Express rule packs.
- Crawlee surface map.
- LangGraph checkpoints and candidate reconciliation.
- Login, logout, reset-request, reset-complete, password-change, and TOTP workflows where evidenced.
- Mailpit, otplib, and persona fixtures.
- Coverage matrix and blocked reporting.
- Screenshots, traces, hashes, and NOTICE.

Exit: two structurally different reference applications produce independently replayable bundles without application-specific generator code.

### Milestone 2 — hardening

- Incremental invalidation.
- Failure clustering and constrained healing.
- Hosted IdP adapter.
- Multiple Playwright projects/browsers.
- More frameworks and optional SCIP precision adapter.
- Adversarial prompt-injection, origin escape, secret leakage, and destructive-action tests.

### Milestone 3 — service mode

- Remote worker protocol.
- Tenant isolation.
- Durable artifact store and retention controls.
- Queueing, quotas, audit export, and cost controls.
- Human review UI.

Do not begin service mode until the bundle and worker contracts are stable.

## 23. Acceptance criteria for the first usable release

1. Given a pinned TypeScript repository and safe test target, Arxic emits a deterministic source manifest and evidence graph.
2. Every behavior candidate is linked to source, runtime, document evidence, or an explicit unsupported diagnostic.
3. A feature found only in source remains hypothesized until executed.
4. A route found only at runtime remains observed until its expected transition is asserted.
5. Each verified auth workflow is an independent Playwright bundle.
6. Password-reset verification reads a real message from the isolated inbox adapter.
7. MFA verification uses a real test TOTP/recovery fixture rather than a mocked success page.
8. Generated tests compile and pass twice from clean fixture state.
9. Required screenshots and trace files are present and hash-verified.
10. The policy gate rejects skip/fixme/only, assertion removal, embedded secrets, unapproved origins, and unsafe actions.
11. Missing fixtures or unreachable behavior appears as blocked, not omitted.
12. Failed generation or verification leaves the prior promoted bundle intact.
13. The output contains licenses, upstream origins, exact versions, modifications, and an SBOM.
14. An upgrade of any major borrowed gear must pass its adapter contract suite before release.

## 24. Risks and mitigations

| Risk | Consequence | Mitigation |
|---|---|---|
| “Full intent” expectation exceeds observable evidence | False confidence | Scope matrix, five truth states, blocked/uncovered report |
| Young repositories appear proven because of star count | Fragile dependency choices | Judge maturity by history, APIs, tests, releases, license, and replacement cost; isolate young code |
| Playwright agent seam changes | Broken generation | Version pin, process adapter, capability handshake, contract tests, direct generator fallback |
| Static extractor misses framework conventions | Missing candidates | ast-grep rule packs, fixtures, existing-test ingestion, runtime surface reconciliation |
| LLM hallucinates a flow or assertion | Invalid test | Structured hypotheses only; deterministic evidence and replay gate |
| Web/repository prompt injection | Unauthorized action or leakage | Treat content as data, fixed policy, allowlisted tools/origins, isolated worker |
| Crawler mutates shared state | Flaky/corrupt environment | Breadth/intention separation, leased personas, serial mutations |
| Generated test “heals” away a product bug | False pass | Semantic diff, forbidden transformations, replay and contradiction status |
| Email/MFA uses real external systems | Side effects and leaked PII | Mailpit/test tenant adapters, network deny, secret references |
| AGPL code enters product accidentally | Distribution obligations | Dependency license gate; reject Hercules code unless deliberately approved |
| Vendored code drifts | Security and maintenance debt | Minimal vendor surface, upstream commit record, parity tests, scheduled review |
| Visual fallback is nondeterministic | Flaky evidence | Optional observer only; Playwright assertion must verify final behavior |

## 25. Consequences

### Positive

- Most difficult infrastructure comes from maintained open-source engines.
- Arxic’s differentiator is clear: evidence, reconciliation, fixtures, coverage, safety, and consumable bundles.
- Components can be upgraded or replaced independently.
- Users can distinguish verified behavior from plausible inference.
- Generated tests remain normal Playwright projects rather than a proprietary runner format.
- Failures retain useful plans, evidence, and blockers without publishing bad tests.

### Negative

- Hybrid verification requires a runnable, safely instrumented test environment.
- Fixture adapters are unavoidable for meaningful business flows.
- The process is slower and more expensive than source-only generation.
- Playwright’s current agent process seam needs active compatibility testing.
- Supporting a new framework means building and maintaining high-quality rule packs.
- “Complete” requires disciplined scope configuration and cannot be a universal claim.

### Accepted trade-off

Arxic chooses trustworthy partial coverage over unverified apparent completeness.

## 26. Decisions intentionally deferred

- Hosted model provider and data-retention policy.
- Whether vendored UA pieces should become an upstream contribution or independent source adapter.
- Hosted IdP providers supported first.
- Artifact signing technology beyond SHA-256 receipts.
- Optional vision observer selection.
- SCIP integration threshold.
- Multi-tenant service storage and scheduling.
- Support for mobile/native applications.

Default until decided: local CLI, configured model adapter with no source retention, Chromium, and isolated first-party test environments.

## 27. Source ledger

### Initial repositories

- Archify repository and MIT license: https://github.com/tt-a1i/archify
- Archify research snapshot: https://github.com/tt-a1i/archify/tree/2c1f8ac2ca28a26d0b68043ec80c9554e20ff0e3
- Archify validator: https://github.com/tt-a1i/archify/blob/2c1f8ac2ca28a26d0b68043ec80c9554e20ff0e3/archify/renderers/shared/validator.mjs
- Archify repository evidence: https://github.com/tt-a1i/archify/blob/2c1f8ac2ca28a26d0b68043ec80c9554e20ff0e3/archify/renderers/shared/repository-evidence.mjs
- Archify delivery contract: https://github.com/tt-a1i/archify/blob/2c1f8ac2ca28a26d0b68043ec80c9554e20ff0e3/archify/references/delivery-contract.md
- Understand Anything repository and MIT license: https://github.com/Egonex-AI/Understand-Anything
- Understand Anything research snapshot: https://github.com/Egonex-AI/Understand-Anything/tree/fe8c5bc591716aafd79b4765549328f08ef5a52e
- Repository scanner: https://github.com/Egonex-AI/Understand-Anything/blob/fe8c5bc591716aafd79b4765549328f08ef5a52e/understand-anything-plugin/skills/understand/scan-project.mjs
- Structure extraction: https://github.com/Egonex-AI/Understand-Anything/blob/fe8c5bc591716aafd79b4765549328f08ef5a52e/understand-anything-plugin/skills/understand/extract-structure.mjs
- Semantic batching: https://github.com/Egonex-AI/Understand-Anything/blob/fe8c5bc591716aafd79b4765549328f08ef5a52e/understand-anything-plugin/skills/understand/compute-batches.mjs
- Domain analyzer instructions: https://github.com/Egonex-AI/Understand-Anything/blob/fe8c5bc591716aafd79b4765549328f08ef5a52e/understand-anything-plugin/agents/domain-analyzer.md
- Lightweight domain context extractor: https://github.com/Egonex-AI/Understand-Anything/blob/fe8c5bc591716aafd79b4765549328f08ef5a52e/understand-anything-plugin/skills/understand-domain/extract-domain-context.py

### Runtime and crawling

- Playwright repository and Apache-2.0 license: https://github.com/microsoft/playwright
- Playwright research snapshot: https://github.com/microsoft/playwright/tree/1720c55cfaddfb01a5bb4c9ddf43e42053811a25
- Playwright Test Agents: https://playwright.dev/docs/test-agents
- Playwright code generation: https://playwright.dev/docs/codegen-intro
- Playwright locators: https://playwright.dev/docs/locators
- Playwright authentication state: https://playwright.dev/docs/auth
- Playwright trace viewer: https://playwright.dev/docs/trace-viewer
- Playwright screenshots: https://playwright.dev/docs/screenshots
- Playwright test options: https://playwright.dev/docs/test-use-options
- Playwright planner tools source: https://github.com/microsoft/playwright/blob/1720c55cfaddfb01a5bb4c9ddf43e42053811a25/packages/playwright/src/mcp/test/plannerTools.ts
- Playwright generator tools source: https://github.com/microsoft/playwright/blob/1720c55cfaddfb01a5bb4c9ddf43e42053811a25/packages/playwright/src/mcp/test/generatorTools.ts
- Playwright test context/journal source: https://github.com/microsoft/playwright/blob/1720c55cfaddfb01a5bb4c9ddf43e42053811a25/packages/playwright/src/mcp/test/testContext.ts
- Playwright healer prompt source: https://github.com/microsoft/playwright/blob/1720c55cfaddfb01a5bb4c9ddf43e42053811a25/packages/playwright/src/agents/playwright-test-healer.agent.md
- Playwright MCP repository: https://github.com/microsoft/playwright-mcp
- Crawlee repository and Apache-2.0 license: https://github.com/apify/crawlee
- Crawlee research snapshot: https://github.com/apify/crawlee/tree/5401ab9770bd2e2e5629316c8b2a7690c39e8096
- PlaywrightCrawler API: https://crawlee.dev/js/api/playwright-crawler/class/PlaywrightCrawler
- RequestQueue API: https://crawlee.dev/js/api/core/class/RequestQueue
- SessionPool API: https://crawlee.dev/js/api/core/class/SessionPool

### Parsing, orchestration, and validation

- ast-grep repository and MIT license: https://github.com/ast-grep/ast-grep
- ast-grep research snapshot: https://github.com/ast-grep/ast-grep/tree/96c6792b51567ad7f35151027c0e5c0679270303
- ast-grep rule configuration: https://ast-grep.github.io/guide/rule-config.html
- ast-grep CLI scan: https://ast-grep.github.io/reference/cli/scan.html
- ast-grep Node API: https://ast-grep.github.io/reference/api.html
- Tree-sitter repository and MIT license: https://github.com/tree-sitter/tree-sitter
- LangGraph.js repository and MIT license: https://github.com/langchain-ai/langgraphjs
- LangGraph durable execution: https://docs.langchain.com/oss/javascript/langgraph/durable-execution
- LangGraph persistence: https://docs.langchain.com/oss/javascript/langgraph/persistence
- Graphology repository and MIT license: https://github.com/graphology/graphology
- AJV repository and MIT license: https://github.com/ajv-validator/ajv

### Authentication fixtures

- Testcontainers for Node repository and MIT license: https://github.com/testcontainers/testcontainers-node
- Testcontainers wait strategies: https://node.testcontainers.org/features/wait-strategies/
- Mailpit repository and MIT license: https://github.com/axllent/mailpit
- Mailpit API documentation: https://mailpit.axllent.org/docs/api-v1/
- otplib repository and MIT license: https://github.com/yeojz/otplib

### Optional/evaluated

- Midscene repository and MIT license: https://github.com/web-infra-dev/midscene
- Stagehand repository and MIT license: https://github.com/browserbase/stagehand
- TestZeus Hercules repository and AGPL-3.0 license: https://github.com/test-zeus-ai/testzeus-hercules
- SCIP protocol: https://github.com/scip-code/scip
- scip-typescript: https://github.com/sourcegraph/scip-typescript

## 28. Final architectural rule

Borrow engines. Vendor only small reviewed seams. Keep every upstream behind an adapter. Preserve licenses and pins. Let models propose. Let runtime observe. Let deterministic gates verify. Publish only atomic, evidence-backed Playwright workflow bundles.
