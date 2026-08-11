# ADR-004: Intent-backed pseudocode (IntentSpec) design

| Field      | Value                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| Status     | Accepted (2026-08-11) — two-app proof matrix landed (PR #134)                                          |
| Decides    | The bounded IntentSpec/oracle-provenance design for deterministic pseudocode and Playwright generation |
| Relates to | ADR-001 §2/§8/§9/§10/§12/§13/§15/§16, ADR-002, issue #116                                              |
| Owners     | Arxic maintainers                                                                                      |

## Context

Arxic needs pseudocode to make generated Playwright deterministic, but source code is
not a business oracle. Source is where to investigate; runtime evidence records what
happened; an independent domain rule, repository specification, or explicit approval
records what should happen. If implementation-derived behavior becomes its own oracle,
Arxic can preserve a defect as an acceptance test.

ADR-001 §2 therefore remains controlling: source/model output is `hypothesized`, runtime
collection is `observed`, and only the deterministic verifier may assign `verified`.
ADR-001 §8 requires output-influencing graph edges to carry evidence, §9 places source
analysis, reconciliation, exploration, compilation, and verification in distinct
stages, and §10 freezes `EvidenceRef`, Workflow IR, diagnostics, and adapter seams.
ADR-002 makes Workflow evidence references opaque IDs resolved by `evidence/index.json`.

The current seams reflect that architecture. `packages/orchestrator-langgraph/src/inference.ts`
produces hypothesis-only Workflow candidates; `exploration.ts` policy-gates targeted
read-only execution and records runtime evidence; `packages/reconciler` classifies
source/runtime conflicts; `packages/playwright-compiler` emits Playwright from frozen
Workflow; `packages/verifier` owns the verification decision. The auth domain pack in
`packages/auth-domain-pack/src/candidates.ts` currently supplies reusable auth outcomes,
while target-specific surface data supplies routes and assertions.

## Decision

### 1. IntentSpec is an unfrozen app-local proposal layer

Choose **(b), an app-local/intermediate proposal type**, implemented as an
Arxic-owned `IntentSpec`/`OracleSpec` layer in the package
`@arxic/intent`. It is not (a) a new frozen `@arxic/contracts` contract and not (c) an
extension of Workflow evidence/provenance.

`IntentSpec` is a bounded, run-local representation between evidence reconciliation and
Workflow compilation. It may contain behavior hypotheses, observed transitions,
resolved assertions, locator candidates, and lineage, but it is not a publication or
verification authority. A proposal can be serialized as a stage artifact and checkpoint
input, subject to the existing ADR-001 §20 run-directory and hash rules, without becoming
a public schema.

This choice follows the ADR-001 §10 freeze rule and its adapter seam header: adding a
type to `@arxic/contracts`, or changing the Workflow/EvidenceRef schemas, requires a
separate ADR. Keeping the layer app-local avoids contract churn and prevents a model or
oracle resolver from manufacturing `status: "verified"`. The later compiler accepts only
resolved controls/assertions and emits the unchanged frozen Workflow; the verifier remains
the sole origin of `verified`.

### 2. Intent and oracle provenance

Every proposed behavior and every generated assertion has machine-readable provenance:

| Kind                       | Supplier and meaning                                                                               | Acceptance use        |
| -------------------------- | -------------------------------------------------------------------------------------------------- | --------------------- |
| `domain-rule`              | Versioned auth/domain pack: a reusable business outcome and its rule/evidence identity             | Acceptance            |
| `repository-specification` | Pinned repository specification, ADR, product requirement, or checked-in test/spec artifact        | Acceptance            |
| `human-approved`           | Recorded approval for the scoped intent/authorization, with approver, scope, and approval artifact | Acceptance            |
| `observed-only`            | Stage-8 exploration observation with runtime evidence, when no independent oracle is linked        | Characterization only |

Source-derived pseudocode is always `hypothesized` or characterization evidence. A source reference alone cannot create `domain-rule` or `repository-specification` provenance.
Human approval authorizes the stated scope or action; it is not verifier evidence and
does not make an assertion true.

An acceptance assertion must link at least one independent oracle of kind
`domain-rule`, `repository-specification`, or `human-approved`, plus source and runtime
evidence references. `observed-only` is explicitly a characterization test: it documents
what the pinned app did and may be replayed, but cannot satisfy an acceptance-oracle gate
or justify `verified` by itself. Missing, ambiguous, stale, or conflicting oracle links
are `blocked` or `contradicted`, never silently upgraded.

The implementation settled the exact field names, oracle artifact identity, scope binding, digest algorithm, approval format, and multiple-oracle conflict handling without creating frozen schema fields; the resolutions are recorded below.

### 3. Owners and dependency direction

`@arxic/intent` owns reusable Service mechanics: proposal normalization, provenance
attachment and validation, oracle-link resolution, deterministic intent canonicalization,
locator candidate reconciliation, and conversion of an already-resolved IntentSpec to
compiler input. It returns structured results and diagnostics; it does not choose when a
stage runs or classify the run outcome.

`@arxic/orchestrator-langgraph` owns the Action flow: stage ordering, checkpointing,
policy/approval decisions, retry and budget boundaries, truth-state classification, and
the decision to continue, characterize, block, or reconcile. `@arxic/reconciler` owns
source/runtime contradiction classification. The auth domain pack owns reusable business
outcomes once; per-app fixtures supply only URLs, accounts, leases, environment/build
facts, and provider capabilities, never expected results.

The dependency direction is:

```text
CLI -> orchestrator-langgraph -> intent -> playwright-compiler -> verifier
                                      \-> contracts (types only, unchanged)
auth-domain-pack -> intent (oracle inputs)
reconciler -> orchestrator/intent (classified evidence inputs)
```

The compiler must not duplicate oracle resolution, exploration policy, or failure
classification. The verifier consumes the compiled frozen bundle and remains the only
`verified` originator. This follows engineering-charter §1: Actions own why/when and
classification; Services own reusable mechanics.

### 4. Eight-step flow and stage ownership

1. **Pin inputs.** Stage 0 in the orchestrator resolves the full source commit, target
   build digest, fixtures/accounts, feature flags, policy, browser, and engine versions.
2. **Analyze source.** Stages 1-4 and the evidence graph produce source-linked behavior
   hypotheses. The inference service may propose pseudocode, but labels it hypothesis;
   it cannot assign an oracle or `verified`.
3. **Explore live behavior.** Stage 8 in `orchestrator-langgraph`, using the browser
   exploration Service, policy-gates `navigate`, `fill`, `click`, and approved `submit`
   actions. It captures before/after state, accessible controls, actual URL/state
   transitions, and runtime `EvidenceRef`s. Origin, action class, lease, budget, and
   human approval rules remain ADR-001 §16 policy.
4. **Reconcile.** Stage 6 in `packages/reconciler` joins source hypotheses to runtime
   observations and labels matches, conflicts, gaps, and unsupported paths using the
   existing truth states.
5. **Resolve the oracle.** A new stage-8/9 Action boundary invokes the `@arxic/intent`
   oracle-resolution Service. Each expected outcome receives exactly one or more
   explicit provenance links. Unresolved outcomes remain hypothesis/observed, become
   characterization when `observed-only`, or are blocked.
6. **Compile.** Stage 9 and `packages/playwright-compiler` compile only resolved
   controls and assertions into the unchanged Workflow IR and staged spec. Every emitted
   assertion retains oracle provenance and source/runtime evidence through the run-local
   provenance/evidence artifacts; opaque Workflow IDs still resolve under ADR-002.
7. **Probe sensitivity.** A new isolated compiler/verifier probe mutates one expected
   result to a deliberately broken result and reruns the generated assertion. The probe
   must fail. A killed mutation proves assertion sensitivity to that mutation, not business
   correctness and not `verified`.
8. **Replay and classify.** Stage 10 resets to clean state and replays at least twice.
   The verifier classifies `verified`, `contradicted`, or `blocked` under ADR-001 §§2,
   15 and 16. No model, IntentSpec, oracle resolver, approval, or observation may assign
   `verified`.

### 5. Gherkin boundary

Gherkin is optional input syntax, not Arxic’s intent contract. If used, the implementation
may pin `@cucumber/gherkin` and call only its public parser/compiler seam. The upstream
`compile` implementation expands backgrounds and scenario outlines into Pickles and
accepts caller-generated IDs; that expansion is useful normalization, not proof. Arxic
must persist an Arxic-derived content digest plus URI, line/span, and AST-node lineage.

Arxic must not persist raw Pickles, source envelopes, or upstream runtime objects, and
must never compile Gherkin directly into frozen Workflow. The intent Service maps bounded
parsed concepts into IntentSpec, then the Arxic compiler performs the oracle and policy
gates. Parser adapters for Robot/Gauge and their execution semantics are deferred; free-
form Webwright generation is rejected.

### 6. Locator and transition policy

Targeted exploration must resolve the accessible control and the actual transition, not
infer them from source names or state labels. Immediately before every normal, non-force
action, a semantic locator (role/accessible name, label, text, or equivalent permitted
public API) and a stable execution locator must each resolve to exactly one live element
and to the **same** element. A test-id may be used as the execution locator only when
that identity check succeeds. Force-click, arbitrary evaluation, and locator healing
that changes the intended outcome remain prohibited by ADR-001 §13.1/§16.

This is a clean-room policy inspired by Playwright’s `selectorGenerator.ts` candidate
ordering and Testing Library’s `getSuggestedQuery` ordering in `suggestions.js`; it is
not an import of either implementation. Ambiguity, drift, mismatch, or inaccessible
controls are diagnostics and do not become generated assertions.

### 7. Sensitivity probe boundary

The probe is a small isolated mutation-style check inspired by Stryker. It changes only
the expected result for one compiled assertion, runs the normal assertion path, and
requires a failure. It must not mutate the application, bypass policy, weaken matchers,
or alter evidence. A passing broken expectation blocks the candidate as insensitive.
The probe is a quality gate for “checks something”; it cannot establish that the expected
result is the right business rule, cannot manufacture runtime evidence, and cannot change
the verifier’s truth-state authority.

### 8. Explicit non-decisions and M2 authorization

This ADR authorized the M2 implementation build and its two-app real-world proof. It does
**not** authorize a frozen-contract or JSON-schema change, a Workflow
extension, a new `@arxic/contracts` export, direct Gherkin-to-Workflow compilation,
free-form generation, unapproved mutation, assertion weakening, or any IntentSpec/oracle
assignment of `verified`. It does not authorize production execution or fixture values
containing expected business outcomes.

The implementation, including the new package, stage wiring, sensitivity probe,
schema/lifecycle decisions, and proof against both fixture apps, was tracked by issue
#116. Acceptance records that the boundary and design direction were implemented and the
required capstone proof landed; it does not grant IntentSpec verification authority.

## Consequences

### Positive

- Implementation-derived pseudocode cannot silently become an acceptance oracle.
- Assertions are inspectable through oracle provenance and source/runtime evidence.
- Domain packs are reusable business knowledge; app fixtures remain factual and portable.
- Existing frozen contracts, evidence resolution, compiler seam, and verifier authority stay stable.
- Targeted exploration produces controls and transitions from the live app rather than guessed routes.
- Characterization tests preserve useful observations without overstating correctness.

### Negative / risk

- More candidates will remain characterized, contradicted, or blocked when no independent rule exists.
- Oracle artifacts and human approvals add lifecycle, staleness, privacy, and review burden.
- Dual locator identity checks and sensitivity runs increase execution cost.
- The unfrozen proposal shape may change during the M2 spike and cannot yet be consumed by external clients.
- A repository specification can itself be stale or defective; provenance identifies its authority but does not make it correct.
- Two clean replays prove the defined workflow under the pinned scope, not universal product correctness.

## Open questions / follow-ups

The implementation build resolved the deciding questions below across slices A-F. Bounded
residuals that are not required for acceptance remain deferred post-acceptance as tracked
follow-ups; no deferred item weakens the two-app acceptance proof.

- Exact `IntentSpec` and `OracleSpec` fields, versioning, lifecycle, and canonical digest — **resolved (slice A, PR #124)**.
- Whether proposal artifacts are checkpointed separately from Workflow artifacts, including retention/redaction rules — **resolved (slice B, PR #125)**: the run-local IntentSpec is persisted in the hash-verified stage-9 artifact under existing run retention rules.
- The machine-readable shape for assertion kind: acceptance versus characterization — **resolved (slice A, PR #124)**: `kind` is derived from oracle provenance.
- Oracle identity, repository-spec section/span, domain-pack rule version, and approval-record binding — **resolved (slice A, PR #124)**.
- Precedence and conflict handling when independent oracle kinds disagree — **resolved (slices A-B, PRs #124-#125)**: divergent acceptance outcomes are contradicted and sticky.
- Staleness detection when source commit, target build, fixture seed, flags, or policy changes — **resolved (slice A, PR #124)** through pinned `IntentLineage` digests.
- How oracle provenance is carried into generated tests without changing frozen Workflow or manifest schemas — **resolved (slice D, PR #130)** through the run-local IntentSpec compiler gate and unchanged frozen bundle schemas.
- Exact before/after state model and accessible-control identity receipt for exploration — **resolved (slice C, PR #126)**.
- Semantic locator vocabulary and same-element proof across frames, redirects, and rerenders — **resolved (slice C, PR #126)** through immediate semantic/execution locator identity checks and fail-closed drift handling.
- Mutation operators, isolation boundary, and minimum sensitivity coverage for the probe — **resolved (slice E, PR #132)**: every required assertion is mutated in an isolated control-plus-mutation run.
- Gherkin package/version/commit pin and the exact `compile` API and lineage extraction seam — **resolved by non-adoption (slices A-F)**: no Gherkin adapter or dependency is needed for the accepted native IntentSpec flow; any future optional syntax adapter requires its own pinned design.
- How domain packs expose outcomes once while fixtures expose only facts and capabilities — **resolved (slice A, PR #124)**.
- Failure diagnostics and classification for missing oracle, stale lineage, ambiguity, mismatch, and insensitive assertions — **resolved (slices A-E, PRs #124-#126, #130, #132)**.
- The required two-app proof matrix, including at least one source/runtime conflict and one observed-only characterization — **resolved (slice F, PR #134)**.
- Mixed-spec `hasAcceptance` fineness — **resolved (PR #136)**: `hasAcceptance` tightened to `everyRequiredAssertionAcceptance` (per-required-transition acceptance-strength; shared multiset matcher).
- Tautological-assertion matcher inversion beyond the bounded `url:` and `text:` operators — **deferred post-acceptance (tracked follow-up)**.
- Per-assertion sensitivity-gate granularity in the stage-10 artifact — **deferred post-acceptance (tracked follow-up)**.
- Replacing `defaultCompile` with the full compiler generator — **deferred post-acceptance (tracked follow-up)**.
- Persisting locator provenance as a dedicated run-local artifact — **deferred post-acceptance (tracked follow-up)**.

## References

- `docs/adr/001-arxic-architecture.md`: §§2, 8-10, 12-16, 19-20, 23, 28.
- `docs/adr/002-evidenceref-resolution.md`: opaque Evidence IDs, `evidence/index.json`, and required-transition semantics.
- `docs/engineering-charter.md`: §§1-2, 4-6; Actions versus Services and independent expected values.
- `packages/contracts/src/adapters.ts`, `workflow.ts`, `evidence-ref.ts`, `evidence-index.ts`: current frozen TypeScript seams.
- `packages/orchestrator-langgraph/src/inference.ts`, `exploration.ts`: hypothesis-only inference and policy-gated observation.
- `packages/auth-domain-pack/src/candidates.ts`: reusable auth outcomes and fixture blockers.
- `packages/playwright-compiler/src/compiler.ts`, `compile-policy.ts`, `spec-generator.ts`: existing Workflow-to-Playwright boundary.
- `packages/verifier/src/verifier.ts`, `classify.ts`: deterministic verification and truth-state classification.
- Cucumber Gherkin `compile.ts` source, pinned by the future implementation: <https://github.com/cucumber/gherkin/blob/main/javascript/src/pickles/compile.ts>.
- playwright-bdd source-span/ambiguity concepts, clean-room reference: <https://github.com/vitalets/playwright-bdd>.
- Playwright selector candidate generation, clean-room reference: <https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/injected/selectorGenerator.ts>.
- Testing Library query suggestions and ordering, clean-room reference: <https://github.com/testing-library/dom-testing-library/blob/main/src/suggestions.js>.
- Serenity/JS Screenplay Task/Interaction/Question concepts: <https://github.com/serenity-js/serenity-js/tree/main/packages/core/src/screenplay>.
- XState deterministic state-transition concepts: <https://github.com/statelyai/xstate/tree/main/packages/core/src>.
- Stryker mutation-testing concepts: <https://github.com/stryker-mutator/stryker-js/tree/master/packages>.
