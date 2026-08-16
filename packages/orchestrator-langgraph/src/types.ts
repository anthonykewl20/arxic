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
import type {
  DomainInventory,
  ProviderIncludeResolution,
  UnresolvedProviderInclude,
} from '@arxic/domain-inventory';
import type { IntentLineage, IntentSpec, OracleSpec, ResolvedAssertion } from '@arxic/intent';
import type { LeaseState } from '@arxic/policy-engine';
import type {
  ExecutionLocator,
  LocatorResolutionFailure,
  SemanticLocator,
} from '@arxic/playwright-agent-adapter';

export type RunStatus =
  'queued' | 'running' | 'awaiting-approval' | 'completed' | 'partial' | 'failed';

/**
 * Stage 13 is the Domain Inventory (DG-06 #250). NUMBERING DECISION (recorded
 * per ADR-008 Consequences "the inventory stage uses the next available ID
 * after structural extraction; exact numbering is an implementation decision
 * recorded at DG-06"): 13 is the next AVAILABLE id — every existing stage id
 * (0–12) remains stable so persisted runs, checkpoint files, and external
 * stage references do not shift. Its POSITION in the graph is immediately
 * after structural extraction (2 → 13 → 3), which is also the position DG-08
 * (#252) needs: stage 4 becomes an IntentProposer over Domain Inventory rows.
 */
export type StageId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
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
  /** SHA-256 fingerprint of the semantic inputs that produced this run. */
  inputFingerprint?: string;
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
  /**
   * DG-06 (#250: "coverage gates consume the inventory so empty-coverage
   * semantics become inventory-derived"): when the default reconciliation
   * runs, the denominator is the runtime-fused Domain Inventory row count and
   * this summary records the disposition split it came from.
   */
  inventory?: Readonly<{
    totalRows: number;
    byDisposition: DomainInventory['stats']['byDisposition'];
    source: 'domain-inventory';
  }>;
}>;

/** The stage-13 artifact envelope (the run-dir inventory + fusion proofs). */
export type DomainInventoryStageArtifact = Readonly<{
  kind: 'arxic-domain-inventory-stage-v1';
  schemaVersion: 1;
  inventory: DomainInventory;
  /** SHA-256 of the canonical stabilized inventory bytes (determinism proof). */
  stableSha256: string;
  providerIncludes: Readonly<{
    resolutions: readonly ProviderIncludeResolution[];
    unresolved: readonly UnresolvedProviderInclude[];
  }>;
  evidenceGraph: Readonly<{
    nodes: number;
    edges: number;
    outputInfluencingEdges: number;
    /** SHA-256 of the canonical evidence-graph projection. */
    canonicalSha256: string;
    diagnostics: readonly Diagnostic[];
  }>;
}>;

/**
 * `inUse` is a coordinator-owned collision signal. Stage-8 receives only available
 * (`false`) lease snapshots and never mutates the persisted fixture artifact.
 */
export type FixtureLeaseState = Readonly<FixtureLease & LeaseState>;

export type FixturePreparation = Readonly<{
  requirements: readonly FixtureRequirement[];
  leases: readonly FixtureLeaseState[];
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
