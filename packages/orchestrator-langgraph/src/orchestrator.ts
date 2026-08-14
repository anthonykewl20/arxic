import { Annotation, END, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
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
import { validateWorkflow } from '@arxic/contracts';
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
  ARXIC_SURFACE_FORM_SUBMIT_BLOCKED,
  CrawleeSurfaceDiscoverer,
  PACKAGE_NAME as CRAWLEE_PACKAGE,
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
import { PACKAGE_NAME as PLAYWRIGHT_PACKAGE } from '@arxic/playwright-agent-adapter';
import {
  ARXIC_PROBE_HARNESS_UNUSABLE,
  CompileError,
  PlaywrightCompiler,
  probeDiagnostic,
} from '@arxic/playwright-compiler';
import {
  PACKAGE_NAME as SOURCE_PACKAGE,
  ARXIC_SOURCE_UNSUPPORTED_LANGUAGE,
  SourceUaAdapter,
  type NormalizedSourceIndex,
} from '@arxic/source-ua-adapter';
import { artifactHash, canonicalJson, type StageCheckpointer } from './checkpointer';
import { FixtureCoordinator } from './fixture-coordinator';
import { defaultExploration } from './exploration';
import { createRunInputFingerprint } from './input-fingerprint';
import { isStage4InferenceFailure, selectNeighbourhood, stage4Infer } from './inference';
import {
  ARXIC_ORCH_EMPTY_COVERAGE,
  ARXIC_ORCH_HASH_MISMATCH,
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
  ExplorationResult,
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

export const ORCHESTRATOR_VERSION = '0.0.0' as const;

const STAGES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
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
  appBuildDigest?: string;
  expectedNonce?: string;
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
  inferCandidates?: (input: InferenceInput) => Promise<unknown>;
  reconcile?: (input: {
    candidates: readonly Candidate[];
    surface: SurfaceMap;
  }) => Promise<CoverageMatrix>;
  prepareFixtures?: (input: { candidates: readonly Candidate[] }) => Promise<FixturePreparation>;
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

  constructor(options: OrchestratorOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async run(input: OrchestratorInput, approval?: ApprovalInput): Promise<RunState> {
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
    const result = await graph.invoke(
      { run: initial },
      { configurable: { thread_id: input.runId } },
    );
    const finalized = finalize(result.run);
    if (finalized.status !== result.run.status) {
      const checkpoint = finalized.checkpoints.at(-1);
      if (checkpoint) {
        await this.#options.checkpointer.saveCheckpoint(input.runId, checkpoint, finalized);
      }
    }
    return finalized;
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
      .addNode('stage-12', node(12));
    graph.addEdge(START, 'stage-0');
    for (let stage = 0; stage < 12; stage += 1) {
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
    return this.#promote(state, input);
  }

  async #attest(input: OrchestratorInput): Promise<StageExecution> {
    const result = await new EnvironmentHandshake().attest(
      { origin: input.origin },
      buildAttestationPolicy({
        origin: input.origin,
        ...(input.appBuildDigest ? { expectedBuildDigest: input.appBuildDigest } : {}),
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
    const evidenceRefs = [...structural.events, ...rules.events].flatMap((event) =>
      'ref' in event && event.ref ? [event.ref] : [],
    );
    const neighbourhood = selectNeighbourhood(evidenceRefs);
    const infer =
      this.#options.inferCandidates ??
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
                  'Inference yielded zero candidates; coverage remains empty',
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
    const inference = await this.#artifact<InferenceResult>(state, input, 4);
    const surface = await this.#artifact<SurfaceMap>(state, input, 5);
    const matrix = await (this.#options.reconcile ?? defaultReconcile)({
      candidates: inference.candidates,
      surface,
    });
    return { artifact: matrix, adapter: '@arxic/reconciler:seam' };
  }

  async #fixtures(state: RunState, input: OrchestratorInput): Promise<StageExecution> {
    const inference = await this.#artifact<InferenceResult>(state, input, 4);
    const result = await (this.#options.prepareFixtures ?? defaultFixturePreparation)({
      candidates: inference.candidates,
    });
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
      ...(approval ? { approval } : {}),
      budget: 8,
    };
    const result = await (this.#options.explore ?? defaultExploration)(explorationInput);
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
    const compileResult = await (this.#options.compile ?? defaultCompile)({
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

function diagnosticsFromEvents(events: EvidenceEvent[]): Diagnostic[] {
  return events.flatMap((event) => ('diagnostic' in event ? [event.diagnostic] : []));
}

/**
 * A denied operation is not necessarily a denied pipeline stage. Source files outside the
 * configured parser set and mutation forms deliberately left untouched by breadth discovery
 * remain audit-visible, but neither disproves nor prevents deterministic verification.
 */
function diagnosticBlocksStage(stage: StageId, diagnostic: Diagnostic): boolean {
  if (diagnostic.severity !== 'blocked') return false;
  if ((stage === 1 || stage === 2) && diagnostic.code === ARXIC_SOURCE_UNSUPPORTED_LANGUAGE) {
    return false;
  }
  if (stage === 5 && diagnostic.code === ARXIC_SURFACE_FORM_SUBMIT_BLOCKED) return false;
  return true;
}

function approvalSummary(approval: HumanApproval): string {
  return `${approval.approver} at ${approval.approvedAt}: ${approval.reason}`;
}

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
    !hasOnlyKeys(record, ['requestId', 'candidates']) ||
    typeof record.requestId !== 'string' ||
    !Array.isArray(record.candidates)
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
  return { requestId: record.requestId, candidates };
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}

async function defaultReconcile(input: {
  candidates: readonly Candidate[];
  surface: SurfaceMap;
}): Promise<CoverageMatrix> {
  const runtimeEvidence = input.surface.routes.filter((route) => route.evidence).length;
  return {
    denominator: input.candidates.length,
    rows: input.candidates.map((candidate) => ({
      candidateId: candidate.id,
      staticEvidence: candidate.evidenceRefs.length,
      runtimeEvidence,
      outcome: runtimeEvidence > 0 ? 'observed' : 'hypothesized',
    })),
  };
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
  return createHash('sha256')
    .update(JSON.stringify(sortKeys(value)))
    .digest('hex');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, nested]) => [key, sortKeys(nested)]),
    );
  }
  return value;
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
