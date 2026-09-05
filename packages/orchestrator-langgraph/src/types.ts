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
// Type-only (erased at compile, so the intent-proposer <-> types cycle is not
// a runtime cycle): the post-crawl re-proposal record on CoverageMatrix below
// carries exactly the proposals the stage-4 proposer produces.
import type { BoundProposal } from './intent-proposer';
import type { LeaseState } from '@arxic/policy-engine';
import type {
  ExecutionLocator,
  FormScope,
  LocatorResolutionDiagnostic,
  LocatorResolutionFailure,
  LocatorResolutionStrategy,
  SemanticLocator,
  StructuralControlConstraint,
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
  /**
   * #324 AC-3 (Cause C): the POST-CRAWL re-proposal record.
   *
   * Stage 4 proposes from the SOURCE inventory built at stage 13, which runs
   * BEFORE the crawl, so `observedForms` is necessarily `[]` and the model is
   * form-blind. This stage is the first point at which a runtime-fused
   * inventory exists, so the re-proposal over form-backed, still-unbound rows
   * happens here and is recorded on THIS artifact.
   *
   * It is deliberately NOT written back onto the stage-4 artifact: that
   * artifact is content-hashed and its checkpoint is part of the bundle
   * integrity chain, and silently rewriting a hashed artifact to improve a
   * coverage ratio would invalidate the exit gate it is measured by.
   */
  postCrawl?: Readonly<{
    /** Consumer row ids the crawl observed a submittable form for. */
    formBackedRowIds: readonly string[];
    /** Form-backed rows that stage 4 left with no proposal — the pass input. */
    reproposedRowIds: readonly string[];
    /** Proposals accepted by the pass, through the SAME binding + dedupe gates. */
    proposals: readonly BoundProposal[];
    /** Why the pass did nothing, when it did nothing. Never silent. */
    skippedReason?: string;
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
    structuralConstraint?: StructuralControlConstraint;
    /** Crawl-bound scope that selected this control on a duplicate-label surface. */
    formScope?: FormScope;
    /** Crawl-label strategy that selected this control, when resolution succeeded. */
    resolutionStrategy?: LocatorResolutionStrategy;
    /** Candidate counts for a fail-closed form-scope or semantic resolution failure. */
    diagnostic?: LocatorResolutionDiagnostic;
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
  /**
   * DG-08: the post-action observation (stabilized URL + bounded heading
   * anchors) when the run's final successful step was a form submit. The
   * compile stage binds assertions from THIS (ADR-008 Decision 7); absent
   * for navigate-only runs.
   */
  postAction?: Readonly<{ url: string; headings: readonly string[] }>;
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
  /** Inventory-bound replay entry, distinct from the post-action runtime evidence. */
  entryUrl?: string;
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
