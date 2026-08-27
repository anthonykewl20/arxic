import { Annotation, END, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import { canonicalJson as serializeCanonicalJson, sha256 } from '@arxic/contracts';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Diagnostic,
  EvidenceEvent,
  EvidenceRef,
  PromotionReceipt,
  SourceRevision,
  StagedBundle,
  TruthState,
  Workflow,
} from '@arxic/contracts';
import { ARXIC_VERSION, validateWorkflow } from '@arxic/contracts';
import {
  PACKAGE_NAME as DOMAIN_INVENTORY_PACKAGE,
  buildSourceInventory,
  fuseRuntimeInventory,
  resolveProviderIncludes,
  serializeInventory,
  validateInventory,
  toProposalConsumerInventory,
} from '@arxic/domain-inventory';
import type { DomainInventory } from '@arxic/domain-inventory';
import { runPostCrawlReproposal, type PostCrawlReproposalOutcome } from './post-crawl-reproposal';
import {
  createContentAddressedArtifacts,
  buildInventoryEvidenceGraph,
} from '@arxic/evidence-graph';
import {
  AstGrepAdapter,
  PACKAGE_NAME as AST_GREP_PACKAGE,
  type AstGrepScanResult,
} from '@arxic/ast-grep-adapter';
import {
  BundlePromoterAdapter,
  PACKAGE_NAME as PROMOTER_PACKAGE,
  projectVerifiedBundle,
} from '@arxic/bundle-promoter';
import {
  ARXIC_SURFACE_EXTERNAL_ORIGIN,
  ARXIC_SURFACE_FORM_SUBMIT_BLOCKED,
  ARXIC_SURFACE_FRONTIER_STOP,
  ARXIC_SURFACE_MUTATION_BLOCKED,
  CrawleeSurfaceDiscoverer,
  PACKAGE_NAME as CRAWLEE_PACKAGE,
  type SurfaceDiscoveryRequest,
  type SurfaceMap,
} from '@arxic/crawlee-adapter';
import {
  buildAttestationPolicy,
  EnvironmentHandshake,
  operatorAttestationSettings,
  PACKAGE_NAME as ENVIRONMENT_PACKAGE,
  type HumanApproval,
} from '@arxic/environment';
import type { ModelAdapter } from '@arxic/model-adapter';
import {
  enforceIntentProvenancePolicy,
  everyRequiredAssertionAcceptance,
  normalizeIntentSpec,
  type IntentSpec,
} from '@arxic/intent';
import {
  PACKAGE_NAME as PLAYWRIGHT_PACKAGE,
  type ExplorationDriver,
} from '@arxic/playwright-agent-adapter';
import {
  ARXIC_PROBE_HARNESS_UNUSABLE,
  CompileError,
  PlaywrightCompiler,
  probeDiagnostic,
} from '@arxic/playwright-compiler';
import {
  PACKAGE_NAME as SOURCE_PACKAGE,
  ARXIC_SOURCE_BINARY_FILE,
  ARXIC_SOURCE_PARSE_ERROR,
  ARXIC_SOURCE_UNSAFE_FILE,
  ARXIC_SOURCE_UNSUPPORTED_LANGUAGE,
  SourceUaAdapter,
  type NormalizedSourceIndex,
} from '@arxic/source-ua-adapter';
import { artifactHash, canonicalJson, type StageCheckpointer } from './checkpointer';
import { FixtureCoordinator } from './fixture-coordinator';
import { runPlannedExploration, type ExplorationPlan } from './exploration';
import { createRunInputFingerprint } from './input-fingerprint';
import { isStage4InferenceFailure, selectNeighbourhood, stage4Infer } from './inference';
import {
  DEFAULT_MODEL_BUDGET_USD,
  proposeCandidates,
  resolveModelPrices,
  type DomainSeeder,
  type ModelPrices,
  type ProposalStageResult,
} from './intent-proposer';
import {
  compileProposalCandidate,
  composeProposalFormDrivePlan,
  selectCompilableCandidate,
  postActionObservationFrom,
} from './proposal-compile';
import {
  ARXIC_ORCH_EMPTY_COVERAGE,
  ARXIC_ORCH_HASH_MISMATCH,
  ARXIC_ORCH_INFERENCE_ERROR,
  ARXIC_ORCH_INPUT_FINGERPRINT_MISMATCH,
  ARXIC_ORCH_INPUT_FINGERPRINT_MISSING,
  ARXIC_ORCH_INPUT_FINGERPRINT_INVALID,
  ARXIC_ORCH_MODEL_RETRIES,
  ARXIC_ORCH_ORACLE_RESOLVED,
  ARXIC_ORCH_ORACLE_UNMATCHED,
  ARXIC_ORCH_REDACTION_FAILED,
  ARXIC_ORCH_HEALING_DEFERRED,
  ARXIC_ORCH_RESUME,
  ARXIC_ORCH_STAGE_BLOCKED,
  orchDiagnostic,
} from './diagnostics';
import type {
  Candidate,
  CompilationResult,
  CoverageMatrix,
  DomainInventoryStageArtifact,
  ExplorationResult,
  FixtureLeaseState,
  FixturePreparation,
  ImmutableArtifactRef,
  InferenceResult,
  OracleResolution,
  OracleResolutionInput,
  OracleRule,
  RunState,
  StageArtifact,
  StageCheckpoint,
  StageId,
  StageStatus,
  VerificationNodeResult,
} from './types';

export const ORCHESTRATOR_VERSION = ARXIC_VERSION;

const STAGES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;
const STAGE_NAMES = [
  'attestation',
  'deterministic-scanning',
  'structural-extraction',
  'framework-rules',
  'inference-orchestration',
  'bounded-discovery',
  'reconciliation',
  'fixture-prep',
  'targeted-exploration',
  'workflow-compiler',
  'verification',
  'healing',
  'promotion',
  // Stage 13: the Domain Inventory (DG-06 #250). NUMBERING (ADR-008
  // Consequences; decision recorded at DG-06): 13 is the NEXT AVAILABLE id —
  // ids 0–12 stay stable for compatibility — while the stage's POSITION in
  // the graph is immediately after structural extraction (2 → 13 → 3). The
  // canonical order lives in ./stage-order.ts (STAGE_EXECUTION_ORDER) —
  // exported for consumers that validate stage sequences; keep this topology
  // and that constant in sync (pinned by the orchestrator suites).
  'domain-inventory',
] as const;

const StateAnnotation = Annotation.Root({
  run: Annotation<RunState>,
});

type GraphState = typeof StateAnnotation.State;

export type OrchestratorInput = Readonly<{
  runId: string;
  origin: string;
  revision: SourceRevision;
  rulepacksDir: string;
  artifactsDir: string;
  framework?: string;
  features?: readonly string[];
  languages?: readonly string[];
  personas?: readonly string[];
  maxUrls?: number;
  maxDepth?: number;
  /**
   * DG-289 C-4 (#289, DECISION issuecomment-5360240026): config-declared
   * `target.allowedOrigins` — flows to the crawl origin gate (stage 5) and
   * the exploration PolicyEngine origin list (stage 6). Fail-closed default
   * when unset/empty: target origin only.
   */
  allowedOrigins?: readonly string[];
  appBuildDigest?: string;
  expectedNonce?: string;
  /**
   * #259: operator-pinned expected build digest — the INDEPENDENT expectation
   * source for the stage-0 attestation gate (`expectedBuildDigest` in the
   * policy). Distinct from `appBuildDigest`, which records the run's
   * evidence digest and is never used as the gate expectation.
   */
  expectedBuildDigest?: string;
  /**
   * DG-297 E2 (#297): the config's `fixtures.replayPersona` declaration plus
   * the env-resolved persona values — authenticates the stage-5 crawl through
   * the target's OWN login form before breadth discovery. Unset → anonymous
   * crawl (byte-identical baseline). Credentials ride in-memory only.
   */
  replayPersona?: NonNullable<SurfaceDiscoveryRequest['replayPersona']>;
  requireExplorationApproval?: boolean;
  modelPrompt?: string;
  credentialBytes?: readonly string[];
  oracleRules?: readonly OracleRule[];
  /**
   * Additional caller policy that changes the run's authorization semantics.
   * Pass JSON-serializable semantics only: JSON drops function values, so they cannot bind reuse.
   */
  policy?: unknown;
  /**
   * Additional caller configuration, including model configuration, that changes run behavior.
   * Pass JSON-serializable semantics only: JSON drops function values, so they cannot bind reuse.
   */
  config?: unknown;
}>;

export type ApprovalInput = Readonly<{
  approver: string;
  approvedAt: string;
  reason: string;
}>;

export type InferenceInput = Readonly<{
  runId: string;
  evidenceRefs: readonly EvidenceRef[];
  prompt?: string;
  attempt: number;
}>;

export type OrchestratorOptions = Readonly<{
  checkpointer: StageCheckpointer;
  now?: () => string;
  maxModelAttempts?: number;
  modelAdapter?: ModelAdapter;
  model?: string;
  /**
   * DG-08 (#252): optional domain-pack seeders/advisors (ADR-008 Decision 3).
   * Seeder output merges through the SAME binding + dedupe gates as model
   * proposals — seeds may advise, never override.
   */
  domainSeeders?: readonly DomainSeeder[];
  /**
   * DG-08 budget cap (ADR-008 Decision 4): the pre-call estimate must stay
   * under this USD cap or the stage blocks with zero provider calls.
   * Owner-overridable; default is the ADR's provisional $0.025.
   */
  modelBudgetUsd?: number;
  modelPrices?: ModelPrices;
  /**
   * Input values (inputRef -> value) the default exploration may use to drive
   * a proposal's form (e.g. persona env). Values are transient: they exist
   * only in in-memory step objects, never in artifacts or checkpoints.
   */
  explorationInputValues?: Readonly<Record<string, string>>;
  /**
   * The FIXTURE KIND that authorizes the form submit under the leased-
   * fixtures-only mutation policy (fixture vocabulary, e.g. 'persona' — not a
   * domain literal). The stage-7 lease of this kind authorizes the submit.
   */
  explorationInputKind?: string;
  inferCandidates?: (input: InferenceInput) => Promise<unknown>;
  reconcile?: (input: {
    candidates: readonly Candidate[];
    surface: SurfaceMap;
  }) => Promise<CoverageMatrix>;
  prepareFixtures?: (input: {
    candidates: readonly Candidate[];
    runId: string;
  }) => Promise<FixturePreparation>;
  /** Service boundary for stage-7 provisioning and terminal cleanup. */
  fixtureCoordinator?: FixtureCoordinator;
  /** Driver injection for the default stage-8 service, primarily sandbox integration. */
  explorationDriver?: ExplorationDriver;
  /** Optional deterministic plan for exercising the default stage-8 service. */
  explorationPlan?: ExplorationPlan;
  explore?: (input: import('./exploration').ExplorationInput) => Promise<ExplorationResult>;
  resolveOracle?: (input: OracleResolutionInput) => Promise<OracleResolution>;
  compile?: (input: {
    candidates: readonly Candidate[];
    observations: readonly EvidenceRef[];
    outputDirectory: string;
    origin: string;
    intentSpec?: IntentSpec;
  }) => Promise<CompilationResult>;
  verify?: (input: CompilationResult) => Promise<VerificationNodeResult>;
  probeSensitivity?: (input: {
    workflow: Workflow;
    origin: string;
    runtimeUrl?: string;
  }) => Promise<{
    killed: boolean;
    probed: number;
    controlPassed: boolean;
    assertions: readonly Readonly<{
      transitionIndex: number;
      assertionIndex: number;
      operators: readonly Readonly<{
        kind: 'value-substitution' | 'control-state-omission';
        killed: boolean;
        controlPassed: boolean;
      }>[];
      killed: boolean;
    }>[];
    diagnostics: readonly Diagnostic[];
  }>;
  promote?: (
    bundle: StagedBundle,
    gates: VerificationNodeResult['gates'],
  ) => Promise<PromotionReceipt>;
}>;

export class WorkerRestartError extends Error {
  constructor(message = 'Worker stopped during the active stage') {
    super(message);
    this.name = 'WorkerRestartError';
  }
}

export class LangGraphOrchestrator {
  readonly #options: OrchestratorOptions;
  readonly #now: () => string;
  readonly #activeFixtureLeases = new Map<string, readonly FixtureLeaseState[]>();

  constructor(options: OrchestratorOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async run(input: OrchestratorInput, approval?: ApprovalInput): Promise<RunState> {
    let graphInvoked = false;
    let terminal = false;
    let runResult: RunState | undefined;
    try {
      const persisted = await this.#options.checkpointer.load(input.runId);
      let inputFingerprint: ReturnType<typeof createRunInputFingerprint>;
      try {
        inputFingerprint = createRunInputFingerprint({
          sourceRevision: input.revision,
          origin: input.origin,
          policy: {
            appBuildDigest: input.appBuildDigest,
            expectedNonce: input.expectedNonce,
            maxDepth: input.maxDepth,
            maxUrls: input.maxUrls,
            requireExplorationApproval: input.requireExplorationApproval,
            supplied: input.policy,
          },
          config: {
            features: input.features,
            framework: input.framework,
            languages: input.languages,
            model: this.#options.model,
            modelPrompt: input.modelPrompt,
            oracleRules: input.oracleRules,
            personas: input.personas,
            rulepacksDir: input.rulepacksDir,
            supplied: input.config,
            credentialBytes: input.credentialBytes,
          },
        });
      } catch {
        return this.#rejectInvalidInputFingerprint(persisted, input.runId);
      }
      if (persisted && persisted.inputFingerprint === undefined) {
        return this.#rejectReuse(
          persisted,
          ARXIC_ORCH_INPUT_FINGERPRINT_MISSING,
          'Persisted run has no input fingerprint and cannot be safely reused',
        );
      }
      if (persisted && persisted.inputFingerprint !== inputFingerprint.sha256) {
        return this.#rejectReuse(
          persisted,
          ARXIC_ORCH_INPUT_FINGERPRINT_MISMATCH,
          'Persisted run input fingerprint does not match the supplied semantic inputs',
        );
      }
      if (
        persisted &&
        (persisted.status === 'completed' || persisted.status === 'partial') &&
        STAGES.every((stage) => persisted.completedStages.includes(stage))
      ) {
        if (!(await this.#verifyTerminalArtifacts(persisted))) {
          return this.#rejectReuse(
            persisted,
            ARXIC_ORCH_HASH_MISMATCH,
            'Persisted terminal artifacts no longer match their recorded SHA-256 hashes',
          );
        }
        return persisted;
      }
      await this.#rehydrateFixtureLeases(persisted, input.runId);
      let initial = persisted ?? queuedState(input.runId, inputFingerprint.sha256);
      if (persisted) {
        initial = {
          ...initial,
          status:
            initial.status === 'awaiting-approval' && !approval ? 'awaiting-approval' : 'running',
          diagnostics: [
            ...initial.diagnostics,
            orchDiagnostic(
              ARXIC_ORCH_RESUME,
              'observed',
              input.runId,
              `Resumed after stage ${String(initial.completedStages.at(-1) ?? 'none')}; only the active stage may re-run`,
            ),
          ],
        };
      }
      if (!persisted) initial = { ...initial, status: 'running' };
      const graph = this.#buildGraph(input, approval).compile({ checkpointer: new MemorySaver() });
      graphInvoked = true;
      const result = await graph.invoke(
        { run: initial },
        { configurable: { thread_id: input.runId } },
      );
      const finalized = finalize(result.run);
      terminal = isTerminalRunStatus(finalized.status);
      if (finalized.status !== result.run.status) {
        const checkpoint = finalized.checkpoints.at(-1);
        if (checkpoint) {
          await this.#options.checkpointer.saveCheckpoint(input.runId, checkpoint, finalized);
        }
      }
      runResult = finalized;
    } finally {
      if (terminal || (graphInvoked && runResult === undefined)) {
        const diagnostics = await this.#releaseRunFixtures(input.runId);
        if (runResult && diagnostics.length > 0) {
          runResult = { ...runResult, diagnostics: [...runResult.diagnostics, ...diagnostics] };
          if (this.#options.checkpointer.saveRunState) {
            try {
              await this.#options.checkpointer.saveRunState(input.runId, runResult);
            } catch {
              // Cleanup diagnostics are best-effort and must not change a terminal run result.
            }
          }
        }
      }
    }
    if (!runResult) throw new Error('Orchestration completed without a run result');
    return runResult;
  }

  async #releaseRunFixtures(runId: string): Promise<readonly Diagnostic[]> {
    const leases = this.#activeFixtureLeases.get(runId);
    this.#activeFixtureLeases.delete(runId);
    if (leases && this.#options.fixtureCoordinator) {
      return this.#options.fixtureCoordinator.release(leases);
    }
    return [];
  }

  async #rehydrateFixtureLeases(persisted: RunState | undefined, runId: string): Promise<void> {
    if (
      !persisted ||
      isTerminalRunStatus(persisted.status) ||
      !persisted.completedStages.includes(7) ||
      this.#activeFixtureLeases.has(runId) ||
      !this.#options.fixtureCoordinator
    ) {
      return;
    }
    const ref = persisted.artifacts[7];
    if (!ref || !(await this.#options.checkpointer.verifyArtifact(runId, ref))) return;
    const fixtures = (await this.#options.checkpointer.readArtifact(
      runId,
      ref,
    )) as FixturePreparation;
    if (!fixtures.provisioned || fixtures.leases.length === 0) return;
    this.#activeFixtureLeases.set(
      runId,
      this.#options.fixtureCoordinator.rehydrate(fixtures.leases, new Date(this.#now())),
    );
  }

  async #verifyTerminalArtifacts(state: RunState): Promise<boolean> {
    const refs = STAGES.map((stage) => state.artifacts[stage]);
    if (refs.some((ref) => ref === undefined)) return false;
    return (
      await Promise.all(
        refs.map(async (ref) => this.#options.checkpointer.verifyArtifact(state.runId, ref!)),
      )
    ).every(Boolean);
  }

  async #rejectReuse(
    state: RunState,
    code:
      | typeof ARXIC_ORCH_INPUT_FINGERPRINT_MISMATCH
      | typeof ARXIC_ORCH_INPUT_FINGERPRINT_MISSING
      | typeof ARXIC_ORCH_HASH_MISMATCH,
    message: string,
  ): Promise<RunState> {
    const blocked: RunState = {
      ...state,
      status: 'failed',
      outcome: 'blocked',
      promotionEligible: false,
      receipt: undefined,
      diagnostics: [...state.diagnostics, orchDiagnostic(code, 'blocked', state.runId, message)],
    };
    return blocked;
  }

  #rejectInvalidInputFingerprint(persisted: RunState | undefined, runId: string): RunState {
    const state =
      persisted ??
      ({
        runId,
        status: 'failed',
        outcome: 'blocked',
        completedStages: [],
        artifacts: {},
        checkpoints: [],
        diagnostics: [],
        promotionEligible: false,
      } satisfies RunState);
    return {
      ...state,
      status: 'failed',
      outcome: 'blocked',
      promotionEligible: false,
      receipt: undefined,
      diagnostics: [
        ...state.diagnostics,
        orchDiagnostic(
          ARXIC_ORCH_INPUT_FINGERPRINT_INVALID,
          'blocked',
          runId,
          'Run input fingerprint requires JSON-serializable policy and configuration semantics',
        ),
      ],
    };
  }

  #buildGraph(input: OrchestratorInput, approval?: ApprovalInput) {
    const node = (stage: StageId) => async (state: GraphState) => ({
      run: await this.#executeStage(stage, state.run, input, approval),
    });
    const graph = new StateGraph(StateAnnotation)
      .addNode('stage-0', node(0))
      .addNode('stage-1', node(1))
      .addNode('stage-2', node(2))
      .addNode('stage-3', node(3))
      .addNode('stage-4', node(4))
      .addNode('stage-5', node(5))
      .addNode('stage-6', node(6))
      .addNode('stage-7', node(7))
      .addNode('stage-8', node(8))
      .addNode('stage-9', node(9))
      .addNode('stage-10', node(10))
      .addNode('stage-11', node(11))
      .addNode('stage-12', node(12))
      .addNode('stage-13', node(13));
    // Execution order: stage 13 (domain-inventory) runs BETWEEN structural
    // extraction (2) and framework rules (3) — see the numbering comment at
    // STAGE_NAMES; ids 0–12 execute in their original order.
    graph.addEdge(START, 'stage-0');
    graph.addEdge('stage-0', 'stage-1');
    graph.addEdge('stage-1', 'stage-2');
    graph.addEdge('stage-2', 'stage-13');
    graph.addEdge('stage-13', 'stage-3');
    for (let stage = 3; stage < 12; stage += 1) {
      graph.addEdge(
        `stage-${stage}` as `stage-${StageId}`,
        `stage-${stage + 1}` as `stage-${StageId}`,
      );
    }
    graph.addEdge('stage-12', END);
    return graph;
  }

  async #executeStage(
    stage: StageId,
    state: RunState,
    input: OrchestratorInput,
    approval?: ApprovalInput,
  ): Promise<RunState> {
    if (state.completedStages.includes(stage)) return state;
    if (state.status === 'failed') return state;
    if (state.status === 'awaiting-approval' && (stage !== 8 || !approval)) return state;
    const startedAt = this.#now();
    let result: StageExecution;
    try {
      result = await this.#runStage(stage, state, input, approval);
    } catch (error) {
      if (error instanceof WorkerRestartError) throw error;
      return this.#failStage(state, stage, startedAt, error, input);
    }
    try {
      return await this.#commitStage(state, stage, startedAt, result, input);
    } catch (error) {
      return this.#failStage(state, stage, startedAt, error, input);
    }
  }

  async #runStage(
    stage: StageId,
    state: RunState,
    input: OrchestratorInput,
    approval?: ApprovalInput,
  ): Promise<StageExecution> {
    if (stage === 0) return this.#attest(input);
    if (stage === 1) return this.#scan(input);
    if (stage === 2) return this.#extract(state, input);
    if (stage === 3) return this.#rules(input);
    if (stage === 4) return this.#infer(state, input);
    if (stage === 5) return this.#discover(input);
    if (stage === 6) return this.#reconcile(state, input);
    if (stage === 7) return this.#fixtures(state, input);
    if (stage === 8) return this.#explore(state, input, approval);
    if (stage === 9) return this.#compile(state, input);
    if (stage === 10) return this.#verify(state, input);
    if (stage === 11) {
      return {
        artifact: { deferred: true, reason: 'Healing is deferred to M2' },
        adapter: '@arxic/orchestrator-langgraph',
        status: 'deferred',
        diagnostics: [
          orchDiagnostic(
            ARXIC_ORCH_HEALING_DEFERRED,
            'observed',
            'stage-11',
            'Healing is deferred to M2; no repair was attempted',
          ),
        ],
        decisions: ['Healing deferred to M2; no repair was attempted'],
      };
    }
    if (stage === 12) return this.#promote(state, input);
    return this.#inventory(state, input);
  }

  /**
   * Stage 13 — the Domain Inventory (DG-06 #250, ADR-008 Decision 2): fuses
   * the TS/JS source enumeration (stage 1) with the REAL DG-05 language-pack
   * route inventories (`collectRouteInventories`, Tree-sitter PHP) and the
   * fusion-layer provider-include prefix composition into ONE deduplicated
   * denominator with a disposition on every row; projects every row into the
   * evidence graph with ≥1 EvidenceRef on each output-influencing edge
   * (ADR-001 §8.4, fail-closed by the graph container).
   *
   * The runtime crawl surface is fused by the SAME deterministic stage at
   * reconciliation (stage 6 consumes this artifact together with the stage-5
   * SurfaceMap) — the crawl has not happened yet at this graph position.
   */
  async #inventory(state: RunState, input: OrchestratorInput): Promise<StageExecution> {
    const source = await this.#artifact<NormalizedSourceIndex>(state, input, 1);
    const adapter = new SourceUaAdapter({ now: this.#now });
    const collected = await adapter.collectRouteInventories({
      revision: input.revision,
      ...(input.languages ? { languages: [...input.languages] } : {}),
    });
    const providerIncludes = await resolveProviderIncludes({
      interchanges: collected,
      readUtf8: repositoryFileReader(input.revision.repository),
    });
    const inventory = buildSourceInventory({
      sourceIndex: source,
      interchanges: providerIncludes.interchanges,
    });
    const validation = validateInventory(inventory);
    const graph = buildInventoryEvidenceGraph({ inventory });
    const canonical = createContentAddressedArtifacts(graph.graph);
    let outputInfluencingEdges = 0;
    graph.graph.forEachEdge((_edge, attributes) => {
      if (attributes.outputInfluencing) outputInfluencingEdges += 1;
    });
    const artifact: DomainInventoryStageArtifact = {
      kind: 'arxic-domain-inventory-stage-v1',
      schemaVersion: 1,
      inventory,
      stableSha256: sha256(serializeInventory(inventory)),
      providerIncludes: {
        resolutions: providerIncludes.resolutions,
        unresolved: providerIncludes.unresolved,
      },
      evidenceGraph: {
        nodes: graph.graph.order,
        edges: graph.graph.size,
        outputInfluencingEdges,
        canonicalSha256: canonical.json.sha256,
        diagnostics: graph.diagnostics,
      },
    };
    const observed = [
      ...(inventory.diagnostics ?? []),
      ...providerIncludes.diagnostics,
      // ALL graph diagnostics flow into the stage: blocked-severity ones
      // (e.g. ARXIC-GRAPH-EDGE-EVIDENCE-MISSING) must fail the stage closed
      // via diagnosticBlocksStage — filtering them here would be fail-open.
      ...graph.diagnostics,
    ];
    return {
      artifact,
      adapter: DOMAIN_INVENTORY_PACKAGE,
      diagnostics: [...(validation.ok ? [] : validation.diagnostics), ...observed],
      toolVersions: { [DOMAIN_INVENTORY_PACKAGE]: ORCHESTRATOR_VERSION },
      decisions: [
        'Stage numbering: id 13 is the next available id; position is after structural extraction (2 → 13 → 3); ids 0–12 unchanged (ADR-008 Consequences, decision recorded at DG-06)',
        providerIncludes.resolutions.length > 0
          ? `Provider-include prefix composition applied to ${providerIncludes.resolutions.length} include(s); ${providerIncludes.unresolved.length} left as visible gaps`
          : 'No provider-include gaps to compose',
        `Inventory denominator: ${inventory.stats.totalRows} rows (${Object.entries(
          inventory.stats.byDisposition,
        )
          .map(([key, value]) => `${value} ${key}`)
          .join(', ')})`,
      ],
      gates: [
        {
          gate: 'inventory-completeness',
          passed: validation.ok && graph.diagnostics.length === 0,
        },
      ],
    };
  }

  async #attest(input: OrchestratorInput): Promise<StageExecution> {
    // #259: the gate's expected digest comes ONLY from the operator-pinned
    // `expectedBuildDigest` — never from `appBuildDigest`, which on the local
    // lane was fetched from the target's own attestation endpoint (making the
    // gate compare the attestation against itself; a tampered digest passed).
    const result = await new EnvironmentHandshake().attest(
      { origin: input.origin },
      buildAttestationPolicy({
        origin: input.origin,
        ...(input.expectedBuildDigest ? { expectedBuildDigest: input.expectedBuildDigest } : {}),
        ...(input.expectedNonce ? { expectedNonce: input.expectedNonce } : {}),
        ...operatorAttestationSettings(process.env),
        now: this.#now,
      }),
    );
    return {
      artifact: result,
      adapter: ENVIRONMENT_PACKAGE,
      diagnostics: result.diagnostics,
      blocked: result.disposition === 'refused',
      fatal: result.disposition === 'refused',
      decisions: [result.decision.reason],
      gates: [{ gate: 'attestation', passed: result.disposition === 'allowed' }],
      approvals: result.decision.override ? [approvalSummary(result.decision.override)] : [],
    };
  }

  async #scan(input: OrchestratorInput): Promise<StageExecution> {
    const result = await new SourceUaAdapter({ now: this.#now }).collect({
      revision: input.revision,
      ...(input.languages ? { languages: [...input.languages] } : {}),
    });
    return {
      artifact: result,
      adapter: SOURCE_PACKAGE,
      diagnostics: diagnosticsFromEvents(result.events),
      toolVersions: result.toolVersions,
    };
  }

  async #extract(state: RunState, input: OrchestratorInput): Promise<StageExecution> {
    const source = await this.#artifact<NormalizedSourceIndex>(state, input, 1);
    return {
      artifact: {
        revision: source.revision,
        events: source.events,
        toolVersions: source.toolVersions,
        structuralExtraction: 'symbols/imports/calls/routes from normalized source index',
      },
      adapter: SOURCE_PACKAGE,
      diagnostics: diagnosticsFromEvents(source.events),
      toolVersions: source.toolVersions,
      decisions: ['Reused immutable stage-1 normalized output; source was not rescanned'],
    };
  }

  async #rules(input: OrchestratorInput): Promise<StageExecution> {
    const framework = input.framework ?? 'nextjs';
    if (!/^[a-z0-9-]+$/u.test(framework)) throw new Error('Framework id is invalid');
    const result = await new AstGrepAdapter({
      packs: [resolve(input.rulepacksDir, framework)],
      now: this.#now,
    }).scan({
      revision: input.revision,
      ...(input.features ? { features: [...input.features] } : {}),
      ...(input.framework ? { framework: input.framework } : {}),
    });
    return {
      artifact: result,
      adapter: AST_GREP_PACKAGE,
      diagnostics: diagnosticsFromEvents(result.events),
      toolVersions: Object.fromEntries(result.packs.map((pack) => [pack.id, pack.version])),
    };
  }

  async #infer(state: RunState, input: OrchestratorInput): Promise<StageExecution> {
    const structural = await this.#artifact<{ events: Array<{ ref?: EvidenceRef }> }>(
      state,
      input,
      2,
    );
    const rules = await this.#artifact<AstGrepScanResult>(state, input, 3);
    // The domain inventory (stage 13) runs before inference by graph order;
    // it makes empty-coverage semantics inventory-derived (#250).
    const inventoryEnvelope = await this.#optionalArtifact<DomainInventoryStageArtifact>(
      state,
      input,
      13,
    );
    const evidenceRefs = [...structural.events, ...rules.events].flatMap((event) =>
      'ref' in event && event.ref ? [event.ref] : [],
    );
    const neighbourhood = selectNeighbourhood(evidenceRefs);
    // DG-08 (#252): with a model configured AND a stage-13 Domain Inventory,
    // stage 4 is the IntentProposer over inventory rows (per-domain batching,
    // content-as-data, bounded retry-then-block, budget-gated). The legacy
    // evidence-metadata inference remains only as the no-inventory fallback.
    const inventoryEnvelopeKnown = inventoryEnvelope !== undefined;
    const proposerInfer =
      this.#options.inferCandidates === undefined &&
      this.#options.modelAdapter &&
      this.#options.model &&
      inventoryEnvelopeKnown
        ? intentProposerInfer(this.#options.modelAdapter, this.#options.model, {
            inventory: toProposalConsumerInventory(inventoryEnvelope.inventory),
            seeders: this.#options.domainSeeders,
            budgetUsd: this.#options.modelBudgetUsd ?? DEFAULT_MODEL_BUDGET_USD,
            // #337: resolve by the CONFIGURED model rather than defaulting to
            // gpt-4o-mini's rates — an unrecognized model id fails closed.
            prices: this.#options.modelPrices ?? resolveModelPrices(this.#options.model),
          })
        : undefined;
    const infer =
      this.#options.inferCandidates ??
      proposerInfer ??
      (this.#options.modelAdapter && this.#options.model
        ? stage4Infer(this.#options.modelAdapter, this.#options.model)
        : defaultInference);
    const attempts = Math.max(1, this.#options.maxModelAttempts ?? 2);
    let lastCause: readonly Diagnostic[] = [];
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const raw = await infer({
        runId: input.runId,
        evidenceRefs: neighbourhood,
        ...(input.modelPrompt ? { prompt: input.modelPrompt } : {}),
        attempt,
      });
      if (isStage4InferenceFailure(raw)) {
        lastCause = raw.diagnostics;
        continue;
      }
      const parsed = parseInferenceResult(raw);
      if (parsed) {
        const diagnostics =
          parsed.candidates.length === 0
            ? [
                orchDiagnostic(
                  ARXIC_ORCH_EMPTY_COVERAGE,
                  'observed',
                  input.runId,
                  inventoryEmptyCoverageMessage(inventoryEnvelope),
                ),
              ]
            : [];
        return {
          artifact: parsed,
          adapter: '@arxic/orchestrator-langgraph:inference',
          modelRequestId: parsed.requestId,
          diagnostics,
          partial: parsed.candidates.length === 0,
          promotionEligible: parsed.candidates.length > 0,
          outcome: parsed.candidates.length === 0 ? 'observed' : 'hypothesized',
        };
      }
      lastCause = [];
    }
    return {
      artifact: { requestId: 'redacted-invalid', candidates: [] },
      adapter: '@arxic/orchestrator-langgraph:inference',
      diagnostics: [
        orchDiagnostic(
          ARXIC_ORCH_MODEL_RETRIES,
          'blocked',
          input.runId,
          lastCause.length > 0
            ? `Stage-4 inference failed after ${attempts} attempts; see carried cause diagnostics`
            : `Structured model output remained invalid after ${attempts} attempts`,
        ),
        ...lastCause,
      ],
      blocked: true,
      fatal: true,
      promotionEligible: false,
      gates: [{ gate: 'model-structured-output', passed: false }],
    };
  }

  /**
   * DG-08: enrich the default exploration input with the proposal form-drive
   * plan when the stage-4 artifact is a proposal run AND the crawl surface
   * has a form for the first candidate's cited route. Requires caller-supplied
   * transient input values for every field (e.g. persona env): without all
   * values the plan stays navigate-only and the compile stage honestly
   * blocks OBSERVATION-MISSING rather than fabricating assertions.
   */
  async #withProposalPlan(
    input: import('./exploration').ExplorationInput,
    state: RunState,
    pipelineInput: OrchestratorInput,
  ): Promise<
    import('./exploration').ExplorationInput &
      Readonly<{ plan?: import('./exploration').ExplorationPlan }>
  > {
    let inference:
      (InferenceResult & { proposalRun?: ProposalStageResult['proposalRun'] }) | undefined;
    let surface: SurfaceMap | undefined;
    try {
      inference = await this.#artifact<
        InferenceResult & { proposalRun?: ProposalStageResult['proposalRun'] }
      >(state, pipelineInput, 4);
      surface = await this.#artifact<SurfaceMap>(state, pipelineInput, 5);
    } catch {
      return input;
    }
    if (!inference?.proposalRun || !surface) return input;
    // #299 (F-E2): plan composition lives in proposal-compile beside the
    // selection it shares with the compile lane (selectCompilableCandidate);
    // this shell only reads the stage artifacts and forwards the caller's
    // transient input values. Undefined plan -> unchanged input (honest
    // 'nothing to observe'; compile blocks OBSERVATION-MISSING, never a
    // guessed form).
    const plan = composeProposalFormDrivePlan({
      candidates: inference.candidates,
      proposals: inference.proposalRun.proposals,
      rows: inference.proposalRun.rows,
      surface,
      origin: input.origin,
      ...(this.#options.explorationInputValues !== undefined
        ? { values: this.#options.explorationInputValues }
        : {}),
      ...(this.#options.explorationInputKind
        ? { fallbackFixtureKind: this.#options.explorationInputKind }
        : {}),
    });
    return plan ? { ...input, plan } : input;
  }

  async #discover(input: OrchestratorInput): Promise<StageExecution> {
    const result = await new CrawleeSurfaceDiscoverer({
      now: this.#now,
      runId: () => input.runId,
    }).collect({
      origin: input.origin,
      ...(input.maxUrls === undefined ? {} : { maxUrls: input.maxUrls }),
      ...(input.maxDepth === undefined ? {} : { maxDepth: input.maxDepth }),
      ...(input.personas ? { personas: [...input.personas] } : {}),
      ...(input.appBuildDigest ? { appBuildDigest: input.appBuildDigest } : {}),
      // DG-297 E2 (#297): authenticated breadth discovery — the declaration
      // + env-resolved persona seed the crawl with the captured storage
      // state; unset omits the field (anonymous crawl, baseline behavior).
      ...(input.replayPersona
        ? {
            replayPersona: {
              declaration: input.replayPersona.declaration,
              persona: { ...input.replayPersona.persona },
            },
          }
        : {}),
      // DG-289 C-4 (#289): declared allowedOrigins flow into the crawl
      // origin gate; unset/empty omits the field and the gate stays
      // fail-closed to the target origin (byte-identical baseline).
      ...(input.allowedOrigins && input.allowedOrigins.length > 0
        ? { allowedOrigins: [...input.allowedOrigins] }
        : {}),
    });
    const blocked = result.diagnostics.some((diagnostic) => diagnosticBlocksStage(5, diagnostic));
    return {
      artifact: result,
      adapter: CRAWLEE_PACKAGE,
      diagnostics: result.diagnostics,
      blocked,
      partial: blocked,
    };
  }

  async #reconcile(state: RunState, input: OrchestratorInput): Promise<StageExecution> {
    const inference = await this.#artifact<
      InferenceResult & { proposalRun?: ProposalStageResult['proposalRun'] }
    >(state, input, 4);
    const surface = await this.#artifact<SurfaceMap>(state, input, 5);
    if (this.#options.reconcile) {
      const matrix = await this.#options.reconcile({
        candidates: inference.candidates,
        surface,
      });
      return { artifact: matrix, adapter: '@arxic/reconciler:seam' };
    }
    // Default reconciliation is INVENTORY-DERIVED (#250: "coverage gates
    // consume the inventory so empty-coverage semantics become
    // inventory-derived"): the denominator is the runtime-fUSED Domain
    // Inventory (stage-13 source denominator + stage-5 crawl surface map),
    // not the candidate count.
    const envelope = await this.#optionalArtifact<DomainInventoryStageArtifact>(state, input, 13);
    const fused = envelope
      ? fuseRuntimeInventory(envelope.inventory, surface, this.#now)
      : undefined;
    const runtimeEvidence = surface.routes.filter((route) => route.evidence).length;
    // #324 AC-3 (Cause C): this is the FIRST point in the pipeline where a
    // runtime-fused inventory exists, so it is the first point where the
    // proposer can be told which surfaces the crawl actually found a form for.
    // The result is recorded on THIS artifact — the stage-4 artifact is
    // content-hashed into the bundle integrity chain and is never rewritten.
    const postCrawl = await this.#postCrawlReproposal(fused, inference, input);
    const matrix: CoverageMatrix = {
      denominator: fused ? fused.stats.totalRows : inference.candidates.length,
      rows: inference.candidates.map((candidate) => ({
        candidateId: candidate.id,
        staticEvidence: candidate.evidenceRefs.length,
        runtimeEvidence,
        outcome: runtimeEvidence > 0 ? 'observed' : 'hypothesized',
      })),
      ...(fused ? { inventory: { ...fused.stats, source: 'domain-inventory' as const } } : {}),
      ...(postCrawl ? { postCrawl: postCrawl.record } : {}),
    };
    return {
      artifact: matrix,
      adapter: '@arxic/reconciler:seam',
      ...(postCrawl && postCrawl.diagnostics.length > 0
        ? { diagnostics: [...postCrawl.diagnostics] }
        : {}),
      decisions: [
        ...(fused
          ? [
              `Coverage denominator derived from the runtime-fused domain inventory (${fused.stats.totalRows} rows)`,
            ]
          : ['Coverage denominator fell back to the candidate count (no inventory artifact)']),
        ...(postCrawl
          ? [
              postCrawl.record.skippedReason === undefined
                ? `Post-crawl re-proposal added ${postCrawl.record.proposals.length} proposal(s) over ${postCrawl.record.reproposedRowIds.length} form-backed row(s)`
                : `Post-crawl re-proposal skipped: ${postCrawl.record.skippedReason}`,
            ]
          : []),
      ],
    };
  }

  /**
   * #324 AC-3: run the post-crawl re-proposal when a fused inventory, a model
   * and a stage-4 proposal run all exist. Returns undefined when the pass does
   * not apply at all (no inventory / no model / legacy non-proposer stage 4),
   * which keeps the artifact byte-identical for those runs.
   */
  async #postCrawlReproposal(
    fused: DomainInventory | undefined,
    inference: InferenceResult & { proposalRun?: ProposalStageResult['proposalRun'] },
    input: OrchestratorInput,
  ): Promise<PostCrawlReproposalOutcome | undefined> {
    if (!fused || !inference.proposalRun) return undefined;
    if (!this.#options.modelAdapter || !this.#options.model) return undefined;
    return runPostCrawlReproposal({
      adapter: this.#options.modelAdapter,
      model: this.#options.model,
      runId: input.runId,
      fusedInventory: fused,
      stage4Proposals: inference.proposalRun.proposals,
      stage4EstimatedCostUsd: inference.proposalRun.estimatedCostUsd,
      budgetUsd: this.#options.modelBudgetUsd ?? DEFAULT_MODEL_BUDGET_USD,
      // #337: resolve by the CONFIGURED model rather than defaulting to
      // gpt-4o-mini's rates — an unrecognized model id fails closed, matching
      // the stage-4 IntentProposer call above.
      prices: this.#options.modelPrices ?? resolveModelPrices(this.#options.model),
    });
  }

  async #fixtures(state: RunState, input: OrchestratorInput): Promise<StageExecution> {
    const inference = await this.#artifact<InferenceResult>(state, input, 4);
    const result = await (this.#options.prepareFixtures
      ? this.#options.prepareFixtures({ candidates: inference.candidates, runId: input.runId })
      : this.#options.fixtureCoordinator
        ? this.#options.fixtureCoordinator.prepare({
            candidates: inference.candidates,
            runId: input.runId,
          })
        : defaultFixturePreparation({ candidates: inference.candidates }));
    if (result.provisioned && this.#options.fixtureCoordinator) {
      this.#activeFixtureLeases.set(input.runId, result.leases);
    }
    return {
      artifact: result,
      adapter: '@arxic/fixture-adapters:seam',
      diagnostics: result.diagnostics,
      blocked: !result.provisioned,
      partial: !result.provisioned,
      promotionEligible: result.provisioned,
      decisions: [
        result.provisioned
          ? `Provisioned ${result.leases.length} disposable fixture leases`
          : 'Fixture provisioning blocked; no fixture was fabricated',
      ],
      gates: [{ gate: 'fixtures', passed: result.provisioned }],
    };
  }

  async #explore(
    state: RunState,
    input: OrchestratorInput,
    approval?: ApprovalInput,
  ): Promise<StageExecution> {
    const inference = await this.#artifact<InferenceResult>(state, input, 4);
    const fixtures = await this.#artifact<FixturePreparation>(state, input, 7);
    const leases = this.#activeFixtureLeases.get(input.runId) ?? fixtures.leases;
    if (input.requireExplorationApproval && !approval) {
      return {
        artifact: { approved: false, evidenceRefs: [], decisions: ['Human approval required'] },
        adapter: '@arxic/targeted-exploration:seam',
        status: 'awaiting-approval',
        decisions: ['Paused before targeted exploration'],
        gates: [{ gate: 'exploration-approval', passed: false }],
      };
    }
    const explorationInput: import('./exploration').ExplorationInput = {
      runId: input.runId,
      origin: input.origin,
      ...(input.appBuildDigest ? { appBuildDigest: input.appBuildDigest } : {}),
      candidates: inference.candidates,
      ...(input.allowedOrigins && input.allowedOrigins.length > 0
        ? { allowedOrigins: [...input.allowedOrigins] }
        : {}),
      ...(leases.length > 0 ? { leases, now: this.#now } : { now: this.#now }),
      ...(approval ? { approval } : {}),
      ...(this.#options.explorationDriver ? { driver: this.#options.explorationDriver } : {}),
      ...(this.#options.explorationPlan ? { plan: this.#options.explorationPlan } : {}),
      budget: 8,
    };
    // DG-08: for proposal runs the default plan DRIVES the first candidate's
    // form (navigate -> fill labelled fields from caller-supplied transient
    // input values -> submit), under this stage's policy engine and lease
    // gates. The final click anchors the post-action observation the compile
    // stage binds assertions from (ADR-008 Decision 7). runPlannedExploration
    // is the default service so an injected plan is honored.
    const effectiveInput = this.#options.explore
      ? explorationInput
      : await this.#withProposalPlan(explorationInput, state, input);
    const result = await (
      this.#options.explore ??
      (async (planInput: import('./exploration').ExplorationInput) =>
        runPlannedExploration(planInput))
    )(effectiveInput);
    return {
      artifact: result,
      adapter: '@arxic/targeted-exploration:seam',
      approvals: approval
        ? [`${approval.approver} at ${approval.approvedAt}: ${approval.reason}`]
        : [],
      decisions: result.decisions,
      gates: [{ gate: 'exploration-approval', passed: result.approved }],
      blocked: !result.approved,
      partial: !result.approved,
    };
  }

  async #compile(state: RunState, input: OrchestratorInput): Promise<StageExecution> {
    const inference = await this.#artifact<InferenceResult>(state, input, 4);
    const exploration = await this.#artifact<ExplorationResult>(state, input, 8);
    const oracleRules = [...(input.oracleRules ?? [])].sort((left, right) =>
      canonicalJson(left).localeCompare(canonicalJson(right)),
    );
    const unmatchedDiagnostics = oracleRules.flatMap(({ candidateId }) =>
      inference.candidates.some(({ id }) => id === candidateId)
        ? []
        : [
            orchDiagnostic(
              ARXIC_ORCH_ORACLE_UNMATCHED,
              'blocked',
              'stage-9',
              `Oracle rule candidateId ${candidateId} did not match an inferred candidate`,
            ),
          ],
    );
    let oracle: OracleResolution = { resolved: [], diagnostics: [], outcome: 'observed' };
    if (this.#options.resolveOracle) {
      const stage0 = await this.#artifact<Record<string, unknown>>(state, input, 0);
      const stage7 = await this.#artifact<FixturePreparation>(state, input, 7);
      const decision = isPlainRecord(stage0.decision) ? stage0.decision : undefined;
      const policyAuthority =
        stage0.policyVersion ??
        stage0.digest ??
        decision?.policyVersion ??
        decision?.digest ??
        stage0;
      oracle = await this.#options.resolveOracle({
        runId: input.runId,
        candidates: inference.candidates,
        observations: exploration.evidenceRefs,
        lineage: {
          commit: input.revision.commit,
          appBuildDigest: input.appBuildDigest ?? input.revision.commit,
          fixtureSeedDigest: stageDigest(stage7.requirements),
          featureFlagsDigest: stageDigest([...(input.features ?? [])].sort()),
          policyDigest: stageDigest(policyAuthority),
        },
        oracleRules,
      });
    }
    const normalization = oracle.intentSpec ? normalizeIntentSpec(oracle.intentSpec) : undefined;
    const hostileVerified = oracle.intentSpec ? containsVerifiedClaim(oracle.intentSpec) : false;
    const normalizationDiagnostics =
      normalization && !normalization.ok ? [...normalization.diagnostics] : [];
    if (hostileVerified) {
      normalizationDiagnostics.push(
        orchDiagnostic(
          ARXIC_ORCH_STAGE_BLOCKED,
          'blocked',
          'stage-9',
          'Oracle IntentSpec attempted to assign verified truth state',
        ),
      );
    }
    const normalizedIntentSpec =
      normalization?.ok && !hostileVerified ? normalization.spec : undefined;
    const candidateWorkflow = inference.candidates[0]?.workflow;
    if (candidateWorkflow && normalizedIntentSpec) {
      const provenancePolicy = enforceIntentProvenancePolicy(
        candidateWorkflow,
        normalizedIntentSpec,
      );
      if (!provenancePolicy.ok) {
        normalizationDiagnostics.push(...provenancePolicy.diagnostics);
      }
    }
    const oracleDiagnostics = [
      ...oracle.diagnostics,
      ...normalizationDiagnostics,
      ...unmatchedDiagnostics,
    ];
    const oracleOutcome: Exclude<TruthState, 'verified'> = oracleDiagnostics.some(
      ({ severity }) => severity === 'blocked',
    )
      ? 'blocked'
      : oracleDiagnostics.some(({ severity }) => severity === 'contradicted')
        ? 'contradicted'
        : nonVerifiedOutcome(oracle.outcome);
    const oracleAllowsPromotion = oracleOutcome !== 'blocked' && oracleOutcome !== 'contradicted';
    if (oracleOutcome === 'blocked' || oracleOutcome === 'contradicted') {
      const result: CompilationResult = {
        compiled: false,
        plan: 'Oracle resolution blocked compilation; no spec generated',
        ...(normalizedIntentSpec ? { intentSpec: normalizedIntentSpec } : {}),
        oracleOutcome,
      };
      return {
        artifact: result,
        adapter: PLAYWRIGHT_PACKAGE,
        diagnostics: oracleDiagnostics,
        blocked: oracleOutcome === 'blocked',
        partial: true,
        promotionEligible: false,
        outcome: oracleOutcome,
        decisions: ['Plan retained as uncompiled'],
        gates: [{ gate: 'compile', passed: false }],
      };
    }
    // DG-08: proposal runs compile through the DG-09 path — the workflow is
    // BORN here from the cited inventory row's form geometry + the stage-8
    // post-action observation (observation-bound assertions only).
    const proposalCompile = this.#options.compile
      ? undefined
      : await this.#proposalCompileInput(inference, exploration, state, input);
    const compileResult = await (
      this.#options.compile ??
      (proposalCompile ? () => compileProposalCandidate(proposalCompile) : defaultCompile)
    )({
      candidates: inference.candidates,
      observations: exploration.evidenceRefs,
      outputDirectory: `${input.artifactsDir}/${input.runId}`,
      origin: input.origin,
      intentSpec: normalizedIntentSpec,
    });
    const result: CompilationResult = {
      ...compileResult,
      ...(normalizedIntentSpec ? { intentSpec: normalizedIntentSpec } : {}),
      oracleOutcome,
    };
    const hasAcceptance =
      normalizedIntentSpec && candidateWorkflow
        ? everyRequiredAssertionAcceptance(candidateWorkflow, normalizedIntentSpec)
        : true;
    const diagnostics = [
      ...oracleDiagnostics,
      ...(result.diagnostics ?? []),
      ...(normalizedIntentSpec
        ? [
            orchDiagnostic(
              ARXIC_ORCH_ORACLE_RESOLVED,
              'observed',
              input.runId,
              `Resolved ${normalizedIntentSpec.assertions.filter(({ kind }) => kind === 'acceptance').length} acceptance and ${normalizedIntentSpec.assertions.filter(({ kind }) => kind === 'characterization').length} characterization assertions with outcome ${oracleOutcome}`,
            ),
          ]
        : []),
    ];
    return {
      artifact: result,
      adapter: PLAYWRIGHT_PACKAGE,
      diagnostics,
      blocked: result.diagnostics?.some(({ severity }) => severity === 'blocked'),
      partial: !result.compiled,
      promotionEligible: result.compiled && oracleAllowsPromotion && hasAcceptance,
      ...(result.diagnostics?.some(({ severity }) => severity === 'blocked')
        ? { outcome: 'blocked' as const }
        : this.#options.resolveOracle !== undefined || oracleDiagnostics.length > 0
          ? { outcome: oracleOutcome }
          : {}),
      decisions: result.compiled ? ['Workflow compiled'] : ['Plan retained as uncompiled'],
      gates: [{ gate: 'compile', passed: result.compiled }],
    };
  }

  /**
   * DG-08: assemble the DG-09 compile input for a proposal run's first
   * candidate, or undefined when the run is not proposal-shaped (legacy
   * candidates keep defaultCompile). The evidence index is re-derived
   * deterministically from the persisted stage-13 inventory envelope (the
   * canonical projection is a pure function of it); the observation comes
   * from the stage-8 post-action record — without it compileProposalCandidate
   * blocks honestly (OBSERVATION-MISSING), never fabricating an assertion.
   */
  async #proposalCompileInput(
    inference: InferenceResult & { proposalRun?: ProposalStageResult['proposalRun'] },
    exploration: ExplorationResult,
    state: RunState,
    input: OrchestratorInput,
  ): Promise<Parameters<typeof compileProposalCandidate>[0] | undefined> {
    if (!inference.proposalRun) return undefined;
    const rows = inference.proposalRun.rows;
    const surface = await this.#artifact<SurfaceMap>(state, input, 5);
    // DG-297 E3 (#297): surface-aware selection — the first candidate whose
    // cited row's route HAS a crawl form surface; when none resolves, the
    // first resolvable (proposal, row) pair flows onward so the compile
    // reports SURFACE-MISSING honestly for candidates[0] (never a silent
    // skip). Replaces the blind candidates[0] take that blocked whole runs
    // on auth-gated SPAs whose every crawled route beyond the login view had
    // no form (F-E: directus blocked on /addons/:param, koel on an API path).
    const selection = selectCompilableCandidate(
      inference.candidates,
      inference.proposalRun.proposals,
      rows,
      surface,
    );
    if (!selection) return undefined;
    const { proposal, row } = selection;
    const envelope = await this.#optionalArtifact<DomainInventoryStageArtifact>(state, input, 13);
    const evidenceIndex = envelope
      ? toProposalConsumerInventory(envelope.inventory).evidenceIndex
      : {};
    // Honesty gate: assertions may bind ONLY from a CLEAN form drive (the
    // stage-8 run approved every required step). A failed drive's final page
    // is NOT the proposal's outcome — compile then blocks
    // OBSERVATION-MISSING instead of fabricating assertions from it.
    const observation = exploration.approved ? postActionObservationFrom(exploration) : undefined;
    return {
      proposal,
      row,
      evidenceIndex,
      surface,
      observation,
      scope: {
        commit: input.revision.commit ?? '0'.repeat(40),
        environment: 'local-test',
        browser: 'chromium',
      },
      origin: input.origin,
      outputDirectory: `${input.artifactsDir}/${input.runId}`,
    };
  }

  async #verify(state: RunState, input: OrchestratorInput): Promise<StageExecution> {
    const compilation = await this.#artifact<CompilationResult>(state, input, 9);
    const result = await (this.#options.verify ?? defaultVerify)(compilation);
    if (result.outcome === 'verified') {
      const stagedBundle = result.stagedBundle;
      const projection = stagedBundle
        ? projectVerifiedBundle(stagedBundle, result, this.#now())
        : { ok: false as const, reason: 'verification-evidence-incomplete' as const };
      if (!projection.ok) {
        const diagnostic = orchDiagnostic(
          ARXIC_ORCH_STAGE_BLOCKED,
          'blocked',
          'stage-10',
          'Deterministic verifier output could not produce one coherent staged bundle',
        );
        const blocked: VerificationNodeResult = {
          ...result,
          outcome: 'blocked',
          diagnostics: [...result.diagnostics, diagnostic],
          gates: [
            ...result.gates.filter(({ gate }) => gate !== 'verify'),
            { gate: 'verify', passed: false, diagnostics: [diagnostic] },
          ],
        };
        return {
          artifact: blocked,
          adapter: '@arxic/verifier:seam',
          diagnostics: blocked.diagnostics,
          blocked: true,
          partial: true,
          promotionEligible: false,
          outcome: 'blocked',
          gates: blocked.gates,
        };
      }
      const projected: VerificationNodeResult = {
        ...result,
        stagedBundle: projection.value,
      };
      if (this.#options.probeSensitivity) {
        const probeBundle = stagedBundle!;
        const runtimeUrl = Object.values(probeBundle.evidenceIndex).find(
          (evidence) => evidence.kind === 'runtime',
        )?.url;
        let probe: Awaited<ReturnType<NonNullable<OrchestratorOptions['probeSensitivity']>>>;
        try {
          probe = await this.#options.probeSensitivity({
            workflow: probeBundle.workflow,
            origin: input.origin,
            ...(runtimeUrl ? { runtimeUrl } : {}),
          });
        } catch (error) {
          const diagnostic = probeDiagnostic(
            ARXIC_PROBE_HARNESS_UNUSABLE,
            probeBundle.workflow.id,
            `Sensitivity probe could not execute: ${error instanceof Error ? error.message : String(error)}`,
          );
          const unusable: VerificationNodeResult = {
            ...projected,
            diagnostics: [...projected.diagnostics, diagnostic],
            gates: [...projected.gates, { gate: 'sensitivity', passed: false }],
            sensitivityProbe: { probed: 0, controlPassed: false, assertions: [] },
          };
          return {
            artifact: unusable,
            adapter: '@arxic/verifier:seam',
            diagnostics: projected.diagnostics,
            partial: true,
            promotionEligible: false,
            outcome: 'verified',
            gates: unusable.gates,
          };
        }
        const probed: VerificationNodeResult = {
          ...projected,
          diagnostics: [...projected.diagnostics, ...probe.diagnostics],
          gates: [...projected.gates, { gate: 'sensitivity', passed: probe.killed }],
          sensitivityProbe: {
            probed: probe.probed,
            controlPassed: probe.controlPassed,
            assertions: probe.assertions,
          },
        };
        return {
          artifact: probed,
          adapter: '@arxic/verifier:seam',
          // Probe blockers gate promotion but do not take truth-state authority from the verifier.
          diagnostics: probe.killed ? probed.diagnostics : projected.diagnostics,
          partial: !probe.killed,
          promotionEligible: probe.killed,
          outcome: 'verified',
          gates: probed.gates,
        };
      }
      return {
        artifact: projected,
        adapter: '@arxic/verifier:seam',
        diagnostics: projected.diagnostics,
        partial: false,
        promotionEligible: true,
        outcome: 'verified',
        gates: projected.gates,
      };
    }
    return {
      artifact: result,
      adapter: '@arxic/verifier:seam',
      diagnostics: [...result.diagnostics],
      blocked: result.outcome === 'blocked',
      partial: true,
      promotionEligible: false,
      outcome: result.outcome,
      gates: [...result.gates],
    };
  }

  async #promote(state: RunState, input: OrchestratorInput): Promise<StageExecution> {
    const verification = await this.#artifact<VerificationNodeResult>(state, input, 10);
    if (
      !state.promotionEligible ||
      verification.outcome !== 'verified' ||
      !verification.stagedBundle
    ) {
      return {
        artifact: { promoted: false, reason: 'No verified staged bundle reached promotion' },
        adapter: PROMOTER_PACKAGE,
        status: 'skipped',
        partial: true,
        promotionEligible: false,
        decisions: ['Promotion skipped: deterministic verifier did not produce a verified bundle'],
        gates: [{ gate: 'promotion', passed: false }],
      };
    }
    const receipt = await (
      this.#options.promote ??
      ((bundle, gates) =>
        new BundlePromoterAdapter({
          publicPath: `${input.artifactsDir}/promoted/${input.runId}.bundle.json`,
          now: this.#now,
        }).promote(bundle, [...gates]))
    )(verification.stagedBundle, verification.gates);
    return {
      artifact: receipt,
      adapter: PROMOTER_PACKAGE,
      receipt,
      gates: [{ gate: 'promotion', passed: true }],
    };
  }

  async #artifact<T>(state: RunState, input: OrchestratorInput, stage: StageId): Promise<T> {
    const ref = state.artifacts[stage];
    if (!ref) throw new Error(`Stage ${stage} artifact reference is missing`);
    const value = await this.#options.checkpointer.readArtifact(input.runId, ref);
    if (!(await this.#options.checkpointer.verifyArtifact(input.runId, ref))) {
      throw new ArtifactHashMismatchError(stage, ref);
    }
    return value as T;
  }

  /** Like #artifact, but returns undefined when the stage has not produced one yet. */
  async #optionalArtifact<T>(
    state: RunState,
    input: OrchestratorInput,
    stage: StageId,
  ): Promise<T | undefined> {
    if (!state.artifacts[stage]) return undefined;
    return this.#artifact<T>(state, input, stage);
  }

  async #commitStage(
    state: RunState,
    stage: StageId,
    startedAt: string,
    result: StageExecution,
    input: OrchestratorInput,
  ): Promise<RunState> {
    const secrets = [input.modelPrompt, ...(input.credentialBytes ?? [])].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    const redactionPassed = !containsSecret(result, secrets);
    if (!redactionPassed) {
      return this.#failStage(state, stage, startedAt, new RedactionError(), input);
    }
    if (result.fatal) {
      return this.#failStage(
        state,
        stage,
        startedAt,
        new Error(`Stage ${stage} returned a fatal result`),
        input,
        result,
      );
    }
    const ref = await this.#options.checkpointer.saveArtifact(input.runId, stage, result.artifact);
    const persisted = await this.#options.checkpointer.readArtifact(input.runId, ref);
    const validHash = [artifactHash(persisted), artifactHash(persisted, true)].includes(ref.sha256);
    if (!validHash) {
      return this.#failStage(
        state,
        stage,
        startedAt,
        new ArtifactHashMismatchError(stage, ref),
        input,
      );
    }
    const diagnostics = [...state.diagnostics, ...(result.diagnostics ?? [])];
    const blocked =
      result.blocked ||
      (result.diagnostics ?? []).some((diagnostic) => diagnosticBlocksStage(stage, diagnostic));
    if (blocked) {
      diagnostics.push(
        orchDiagnostic(
          ARXIC_ORCH_STAGE_BLOCKED,
          'blocked',
          `stage-${stage}`,
          `Stage ${stage} returned blocked diagnostics`,
        ),
      );
    }
    const status = result.status ?? 'completed';
    const completedStages =
      status === 'awaiting-approval' ? state.completedStages : [...state.completedStages, stage];
    const checkpoint: StageCheckpoint = {
      stage,
      name: STAGE_NAMES[stage],
      status,
      startedAt,
      finishedAt: this.#now(),
      adapter: { name: result.adapter, version: ORCHESTRATOR_VERSION },
      orchestratorVersion: ORCHESTRATOR_VERSION,
      artifacts: [ref],
      toolVersions: result.toolVersions ?? {},
      ...(result.modelRequestId ? { modelRequestId: result.modelRequestId } : {}),
      decisions: result.decisions ?? [],
      approvals: result.approvals ?? [],
      gateResults: result.gates ?? [],
      redaction: {
        passed: true,
        redactedFields: secrets.length > 0 ? ['modelPrompt', 'credentials'] : [],
      },
    };
    const next: RunState = {
      ...state,
      status: nextRunStatus(state, result, status, blocked),
      outcome: nextOutcome(state, result, blocked),
      activeStage: stage,
      completedStages,
      artifacts: { ...state.artifacts, [stage]: ref },
      checkpoints: [...state.checkpoints, checkpoint],
      diagnostics,
      promotionEligible:
        state.promotionEligible &&
        !blocked &&
        (result.promotionEligible === undefined || result.promotionEligible),
      ...(result.receipt ? { receipt: result.receipt } : {}),
    };
    await this.#options.checkpointer.saveCheckpoint(input.runId, checkpoint, next);
    return next;
  }

  async #failStage(
    state: RunState,
    stage: StageId,
    startedAt: string,
    error: unknown,
    input: OrchestratorInput,
    result?: StageExecution,
  ): Promise<RunState> {
    const hashMismatch = error instanceof ArtifactHashMismatchError;
    const configuredSecrets = [input.modelPrompt, ...(input.credentialBytes ?? [])].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    const redaction =
      error instanceof RedactionError || containsSecret(errorMessage(error), configuredSecrets);
    const diagnostic = orchDiagnostic(
      failureDiagnosticCode(hashMismatch, redaction),
      'blocked',
      `stage-${stage}`,
      failureMessage(error, redaction),
    );
    const checkpoint: StageCheckpoint = {
      stage,
      name: STAGE_NAMES[stage],
      status: 'failed',
      startedAt,
      finishedAt: this.#now(),
      adapter: {
        name: result?.adapter ?? '@arxic/orchestrator-langgraph',
        version: ORCHESTRATOR_VERSION,
      },
      orchestratorVersion: ORCHESTRATOR_VERSION,
      artifacts: [],
      toolVersions: {},
      decisions: result?.decisions ?? ['Stage failed closed'],
      approvals: result?.approvals ?? [],
      gateResults: result?.gates ?? [{ gate: redaction ? 'redaction' : 'stage', passed: false }],
      redaction: { passed: !redaction, redactedFields: [] },
    };
    const failed: RunState = {
      ...state,
      status: 'failed',
      outcome: 'blocked',
      activeStage: stage,
      checkpoints: [...state.checkpoints, checkpoint],
      diagnostics: [...state.diagnostics, ...(result?.diagnostics ?? []), diagnostic],
      promotionEligible: false,
    };
    await this.#options.checkpointer.saveCheckpoint(input.runId, checkpoint, failed);
    return failed;
  }
}

type StageExecution = Readonly<{
  artifact: StageArtifact;
  adapter: string;
  status?: StageStatus;
  diagnostics?: readonly Diagnostic[];
  toolVersions?: Readonly<Record<string, string>>;
  modelRequestId?: string;
  decisions?: readonly string[];
  approvals?: readonly string[];
  gates?: VerificationNodeResult['gates'];
  blocked?: boolean;
  fatal?: boolean;
  partial?: boolean;
  promotionEligible?: boolean;
  outcome?: RunState['outcome'];
  receipt?: RunState['receipt'];
}>;

class ArtifactHashMismatchError extends Error {
  constructor(stage: StageId, ref: ImmutableArtifactRef) {
    super(`Artifact hash mismatch for stage ${stage} (${ref.id})`);
    this.name = 'ArtifactHashMismatchError';
  }
}

class RedactionError extends Error {}

function queuedState(runId: string, inputFingerprint: string): RunState {
  return {
    runId,
    inputFingerprint,
    status: 'queued',
    outcome: 'hypothesized',
    completedStages: [],
    artifacts: {},
    checkpoints: [],
    diagnostics: [],
    promotionEligible: true,
  };
}

function finalize(state: RunState): RunState {
  if (state.status === 'failed' || state.status === 'awaiting-approval') return state;
  if (state.completedStages.length < STAGES.length) return state;
  if (state.receipt) return { ...state, status: 'completed' };
  if (state.status === 'partial' || state.outcome === 'blocked')
    return { ...state, status: 'partial' };
  return { ...state, status: 'completed' };
}

function isTerminalRunStatus(status: RunState['status']): boolean {
  return status === 'completed' || status === 'partial' || status === 'failed';
}

function diagnosticsFromEvents(events: EvidenceEvent[]): Diagnostic[] {
  return events.flatMap((event) => ('diagnostic' in event ? [event.diagnostic] : []));
}

/**
 * A denied operation is not necessarily a denied pipeline stage. Source files outside the
 * configured parser set and mutation forms deliberately left untouched by breadth discovery
 * remain audit-visible, but neither disproves nor prevents deterministic verification.
 */
export function diagnosticBlocksStage(stage: StageId, diagnostic: Diagnostic): boolean {
  if (diagnostic.severity !== 'blocked') return false;
  // #320 (F-E12, campaign round 12): the source coverage-boundary family —
  // binary assets (BINARY-FILE), tree-sitter partial parses (PARSE-ERROR),
  // and symlinks (UNSAFE-FILE) — records the deterministic scanner's
  // honest coverage boundary, exactly like UNSUPPORTED-LANGUAGE (exempt
  // since DG-06). They stay in the run record as blocked-severity
  // diagnostics with their counts, and the domain inventory still accounts
  // their rows as unextracted (honest-zero machinery, #250); they must not
  // poison the sticky outcome — the fixture app happens to emit only
  // UNSUPPORTED-LANGUAGE, while ANY real repository carries binary assets,
  // partial parses, or symlinks and could then never promote. Genuinely
  // dangerous stage-1/2 conditions (redaction failure, hash mismatch,
  // fatal scan errors) keep blocking.
  if (
    (stage === 1 || stage === 2) &&
    (diagnostic.code === ARXIC_SOURCE_UNSUPPORTED_LANGUAGE ||
      diagnostic.code === ARXIC_SOURCE_BINARY_FILE ||
      diagnostic.code === ARXIC_SOURCE_PARSE_ERROR ||
      diagnostic.code === ARXIC_SOURCE_UNSAFE_FILE)
  ) {
    return false;
  }
  // #318 (F-E11, campaign round 11): breadth-discovery boundary
  // observations record the containment policy HOLDING — external-origin
  // containment (001), depth-bound frontier stops (003), default-deny
  // mutation aborts (008) — exactly like the already-exempted form-submit
  // hold (002). They stay in the run record as blocked-severity
  // diagnostics (never dropped) but must not poison the sticky outcome:
  // the fixture app happens to emit only exempt codes, while ANY real
  // target with external links, deeper paths, or protected POSTs emits
  // 001/003/008 and could then never promote. Genuinely dangerous codes
  // (006 invalid origin, 007 unattested build) and unknown codes keep
  // blocking.
  if (
    stage === 5 &&
    (diagnostic.code === ARXIC_SURFACE_FORM_SUBMIT_BLOCKED ||
      diagnostic.code === ARXIC_SURFACE_EXTERNAL_ORIGIN ||
      diagnostic.code === ARXIC_SURFACE_FRONTIER_STOP ||
      diagnostic.code === ARXIC_SURFACE_MUTATION_BLOCKED)
  ) {
    return false;
  }
  return true;
}

function approvalSummary(approval: HumanApproval): string {
  return `${approval.approver} at ${approval.approvedAt}: ${approval.reason}`;
}

/** Empty coverage is honest only relative to a denominator (#250). */
function inventoryEmptyCoverageMessage(envelope: DomainInventoryStageArtifact | undefined): string {
  if (!envelope) return 'Inference yielded zero candidates; coverage remains empty';
  const { totalRows, byDisposition } = envelope.inventory.stats;
  const accounted =
    byDisposition.unsupported + byDisposition.unsafe + byDisposition['unextracted-with-reason'];
  return `Inference yielded zero candidates over a domain inventory of ${totalRows} rows (${byDisposition.extracted} extracted, ${accounted} accounted by dispositions); coverage remains empty — honest zero, no fabricated intents`;
}

/**
 * Root-relative UTF-8 reader for provider-include composition. Only local
 * `file://` (or plain path) repositories can be read; anything else (or any
 * escape out of the repository root) reads as null, which keeps the include a
 * visible structured gap instead of guessing a prefix.
 */
function repositoryFileReader(repository: string): (path: string) => Promise<string | null> {
  return async (path) => {
    try {
      const root = repository.startsWith('file://')
        ? fileURLToPath(new URL(repository))
        : repository;
      const resolvedRoot = resolve(root);
      const target = resolve(resolvedRoot, path);
      if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${sep}`)) return null;
      return await readFile(target, 'utf8');
    } catch {
      return null;
    }
  };
}

/**
 * DG-08 stage-4 default: adapt `proposeCandidates` to the inferCandidates seam
 * so the orchestrator's existing retry/empty-coverage accounting consumes the
 * proposer's result unchanged. Returns the stage-4 failure sentinel on a
 * blocked run (bounded retries exhausted / budget exceeded) with carried
 * cause diagnostics.
 */
function intentProposerInfer(
  adapter: NonNullable<OrchestratorOptions['modelAdapter']>,
  model: string,
  options: {
    inventory: ReturnType<typeof toProposalConsumerInventory>;
    seeders?: readonly DomainSeeder[];
    budgetUsd: number;
    prices: ModelPrices;
  },
): (input: InferenceInput) => Promise<unknown> {
  return async (input) => {
    try {
      const outcome = await proposeCandidates({
        adapter,
        model,
        inventory: options.inventory,
        runId: input.runId,
        ...(options.seeders ? { seeders: options.seeders } : {}),
        budgetUsd: options.budgetUsd,
        prices: options.prices,
      });
      if (!outcome.ok) {
        return {
          stage4InferenceFailed: 'stage4-inference-failed' as const,
          diagnostics: outcome.diagnostics,
        };
      }
      return outcome.result;
    } catch {
      // Do not preserve the thrown message: it may contain prompt or
      // credential bytes (same redaction contract as the legacy stage4Infer).
      return {
        stage4InferenceFailed: 'stage4-inference-failed' as const,
        diagnostics: [
          orchDiagnostic(
            ARXIC_ORCH_INFERENCE_ERROR,
            'blocked',
            input.runId,
            'Stage-4 intent proposal threw an unexpected error; cause redacted',
          ),
        ],
      };
    }
  };
}

/**
 * DG-08 enrichment happens as a private method (needs #artifact access).
 */
async function defaultInference(input: InferenceInput): Promise<InferenceResult> {
  return {
    requestId: `stage4-no-model-${input.runId}-${input.attempt}`,
    candidates: [],
  };
}

function parseInferenceResult(value: unknown): InferenceResult | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(record, ['requestId', 'candidates', 'diagnostics', 'proposalRun']) ||
    typeof record.requestId !== 'string' ||
    !Array.isArray(record.candidates)
  ) {
    return undefined;
  }
  if (
    record.diagnostics !== undefined &&
    (!Array.isArray(record.diagnostics) ||
      !record.diagnostics.every((diagnostic) => validateDiagnosticShape(diagnostic)))
  ) {
    return undefined;
  }
  const candidates: Candidate[] = [];
  for (const candidate of record.candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
    const item = candidate as Record<string, unknown>;
    if (
      !hasOnlyKeys(item, ['id', 'title', 'evidenceRefs', 'workflow']) ||
      typeof item.id !== 'string' ||
      typeof item.title !== 'string' ||
      !Array.isArray(item.evidenceRefs) ||
      !item.evidenceRefs.every((ref) => typeof ref === 'string')
    ) {
      return undefined;
    }
    let workflow: Workflow | undefined;
    if (item.workflow !== undefined) {
      const validation = validateWorkflow(item.workflow);
      if (!validation.ok || validation.value.status === 'verified') return undefined;
      workflow = { ...validation.value, status: 'hypothesized' };
    }
    candidates.push({
      id: item.id,
      title: item.title,
      evidenceRefs: item.evidenceRefs,
      ...(workflow ? { workflow } : {}),
    });
  }
  // DG-08: pass the proposal-run metadata (and honest-ledger diagnostics)
  // through when present and well-formed; otherwise collapse to the plain
  // InferenceResult (the artifact store stays backward compatible).
  const diagnostics =
    Array.isArray(record.diagnostics) && record.diagnostics.length > 0
      ? { diagnostics: record.diagnostics as Diagnostic[] }
      : {};
  const proposalRun = isPlainRecord(record.proposalRun)
    ? { proposalRun: record.proposalRun as unknown as ProposalStageResult['proposalRun'] }
    : {};
  return { requestId: record.requestId, candidates, ...diagnostics, ...proposalRun };
}

function validateDiagnosticShape(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Diagnostic).code === 'string' &&
    typeof (value as Diagnostic).severity === 'string' &&
    Object.keys(value as Diagnostic).every((key) =>
      ['code', 'severity', 'subject', 'message', 'evidenceRefs'].includes(key),
    )
  );
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}

async function defaultFixturePreparation(input: {
  candidates: readonly Candidate[];
}): Promise<FixturePreparation> {
  return new FixtureCoordinator([]).prepare(input);
}

async function defaultCompile(input: {
  candidates: readonly Candidate[];
  observations: readonly EvidenceRef[];
  outputDirectory: string;
  origin: string;
}): Promise<CompilationResult> {
  const workflow = input.candidates[0]?.workflow;
  if (!workflow) return { compiled: false, plan: 'No workflow candidate was available to compile' };
  try {
    const bundle = await new PlaywrightCompiler({
      outputDirectory: input.outputDirectory,
      origin: input.origin,
    }).compile(workflow, [...input.observations]);
    return { compiled: true, plan: bundle.plan, workflow, stagedBundle: bundle };
  } catch (error) {
    const diagnostic =
      error instanceof CompileError
        ? error.diagnostic
        : orchDiagnostic(
            ARXIC_ORCH_STAGE_BLOCKED,
            'blocked',
            workflow.id,
            'The workflow compiler failed before producing a safe diagnostic',
          );
    return {
      compiled: false,
      plan: `Compilation blocked (${diagnostic.code})`,
      diagnostics: [diagnostic],
      workflow,
    };
  }
}

async function defaultVerify(_compilation: CompilationResult): Promise<VerificationNodeResult> {
  void _compilation;
  return {
    outcome: 'observed',
    diagnostics: [],
    artifacts: [],
    runs: [],
    gates: [{ gate: 'verify', passed: false }],
  };
}

function containsSecret(value: unknown, secrets: readonly string[]): boolean {
  if (secrets.length === 0) return false;
  const bytes = JSON.stringify(value);
  return secrets.some((secret) => {
    const escaped = JSON.stringify(secret).slice(1, -1);
    return bytes.includes(secret) || bytes.includes(escaped);
  });
}

function nextRunStatus(
  state: RunState,
  result: StageExecution,
  stageStatus: StageStatus,
  blocked: boolean,
): RunState['status'] {
  if (result.fatal) return 'failed';
  if (stageStatus === 'awaiting-approval') return 'awaiting-approval';
  if (result.partial || blocked || state.status === 'partial') return 'partial';
  return 'running';
}

function nextOutcome(
  state: RunState,
  result: StageExecution,
  blocked: boolean,
): RunState['outcome'] {
  if (result.fatal || blocked) return 'blocked';
  if (state.outcome === 'blocked') return 'blocked';
  if (result.outcome === 'blocked') return 'blocked';
  if (state.outcome === 'contradicted') return 'contradicted';
  if (result.outcome === 'contradicted') return 'contradicted';
  if (result.outcome) return result.outcome;
  return state.outcome;
}

function stageDigest(value: unknown): string {
  return sha256(serializeCanonicalJson(value, { mode: 'legacy' }));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function containsVerifiedClaim(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsVerifiedClaim);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, nested]) =>
      (key === 'truthState' && nested === 'verified') || containsVerifiedClaim(nested),
  );
}

function nonVerifiedOutcome(value: unknown): Exclude<TruthState, 'verified'> {
  if (
    value === 'hypothesized' ||
    value === 'observed' ||
    value === 'contradicted' ||
    value === 'blocked'
  ) {
    return value;
  }
  throw new Error('Oracle resolution returned an invalid truth-state outcome');
}

function failureDiagnosticCode(hashMismatch: boolean, redaction: boolean) {
  if (hashMismatch) return ARXIC_ORCH_HASH_MISMATCH;
  if (redaction) return ARXIC_ORCH_REDACTION_FAILED;
  return ARXIC_ORCH_STAGE_BLOCKED;
}

function failureMessage(error: unknown, redaction: boolean): string {
  if (redaction) {
    return 'Redaction gate found prompt or credential bytes; artifact persistence was refused';
  }
  return error instanceof Error ? error.message : String(error);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
