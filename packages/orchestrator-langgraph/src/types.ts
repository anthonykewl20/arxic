import type {
  Diagnostic,
  EvidenceRef,
  FixtureLease,
  FixtureRequirement,
  GateResult,
  PromotionReceipt,
  StagedBundle,
  TruthState,
  Workflow,
} from '@arxic/contracts';
import type { IntentLineage, IntentSpec, OracleSpec, ResolvedAssertion } from '@arxic/intent';
import type {
  ExecutionLocator,
  LocatorResolutionFailure,
  SemanticLocator,
} from '@arxic/playwright-agent-adapter';

export type RunStatus =
  'queued' | 'running' | 'awaiting-approval' | 'completed' | 'partial' | 'failed';

export type StageId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
export type StageStatus = 'completed' | 'awaiting-approval' | 'skipped' | 'deferred' | 'failed';

export type ImmutableArtifactRef = Readonly<{ id: string; sha256: string }>;

export type StageCheckpoint = Readonly<{
  stage: StageId;
  name: string;
  status: StageStatus;
  startedAt: string;
  finishedAt: string;
  adapter: Readonly<{ name: string; version: string }>;
  orchestratorVersion: string;
  artifacts: readonly ImmutableArtifactRef[];
  toolVersions: Readonly<Record<string, string>>;
  modelRequestId?: string;
  decisions: readonly string[];
  approvals: readonly string[];
  gateResults: readonly GateResult[];
  redaction: Readonly<{ passed: boolean; redactedFields: readonly string[] }>;
}>;

export type RunState = Readonly<{
  runId: string;
  status: RunStatus;
  outcome: TruthState;
  activeStage?: StageId;
  completedStages: readonly StageId[];
  artifacts: Readonly<Partial<Record<StageId, ImmutableArtifactRef>>>;
  checkpoints: readonly StageCheckpoint[];
  diagnostics: readonly Diagnostic[];
  promotionEligible: boolean;
  receipt?: PromotionReceipt;
}>;

export type Candidate = Readonly<{
  id: string;
  title: string;
  evidenceRefs: readonly string[];
  workflow?: Workflow;
}>;

export type InferenceResult = Readonly<{
  requestId: string;
  candidates: readonly Candidate[];
}>;

export type CoverageMatrix = Readonly<{
  denominator: number;
  rows: readonly Readonly<{
    candidateId: string;
    staticEvidence: number;
    runtimeEvidence: number;
    outcome: Exclude<TruthState, 'verified'>;
  }>[];
}>;

export type FixturePreparation = Readonly<{
  requirements: readonly FixtureRequirement[];
  leases: readonly FixtureLease[];
  diagnostics: readonly Diagnostic[];
}> &
  Readonly<{ provisioned: true } | { provisioned: false }>;

export type LocatorProvenanceRecord = Readonly<
  {
    intent: string;
    semantic: SemanticLocator;
    execution: ExecutionLocator;
  } & (
    | Readonly<{ resolved: true; sameElementProof: true }>
    | Readonly<{ resolved: false; reason: LocatorResolutionFailure }>
  )
>;

export type ExplorationResult = Readonly<{
  approved: boolean;
  evidenceRefs: readonly EvidenceRef[];
  decisions: readonly string[];
  locatorProvenance?: Readonly<{ records: readonly LocatorProvenanceRecord[] }>;
}>;

export type OracleRule = Readonly<{
  candidateId: string;
  oracle: OracleSpec;
}>;

export type OracleResolutionInput = Readonly<{
  runId: string;
  candidates: readonly Candidate[];
  observations: readonly EvidenceRef[];
  lineage: IntentLineage;
  oracleRules: readonly OracleRule[];
}>;

export type OracleResolution = Readonly<{
  intentSpec?: IntentSpec;
  resolved: readonly ResolvedAssertion[];
  diagnostics: readonly Diagnostic[];
  outcome: Exclude<TruthState, 'verified'>;
}>;

export type CompilationResult = Readonly<{
  compiled: boolean;
  plan: string;
  diagnostics?: readonly Diagnostic[];
  workflow?: Workflow;
  stagedBundle?: StagedBundle;
  intentSpec?: IntentSpec;
  oracleOutcome?: Exclude<TruthState, 'verified'>;
}>;

export type VerificationNodeResult = Readonly<{
  outcome: TruthState;
  diagnostics: readonly Diagnostic[];
  artifacts: readonly Readonly<{ kind: string; path: string; sha256: string }>[];
  runs: readonly Readonly<{ passed: boolean }>[];
  stagedBundle?: StagedBundle;
  gates: readonly GateResult[];
  sensitivityProbe?: Readonly<{
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
  }>;
}>;

export type StageArtifact = unknown;
