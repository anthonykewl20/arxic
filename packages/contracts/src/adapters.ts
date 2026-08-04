import type { Diagnostic } from './diagnostics';
import type { EvidenceIndex } from './evidence-index';
import type { EvidenceRef } from './evidence-ref';
import type { BundleManifest } from './manifest';
import type { SourceRevision } from './source-revision';
import type { TruthState, Workflow } from './workflow';

export type ActionClass =
  'read-only' | 'reversible-mutation' | 'external-side-effect' | 'destructive';

export type ArtifactRef = { kind: string; path: string; sha256: string };

export type EvidenceEvent = { ref: EvidenceRef } | { diagnostic: Diagnostic };

export type ScopeMatrix = {
  domains?: string[];
  frameworks?: string[];
  personas?: string[];
  routes?: string[];
};

export type SourceIndexRequest = {
  revision: SourceRevision;
  languages?: string[];
  scope?: ScopeMatrix;
};

export type DiscoveryRequest = {
  origin: string;
  maxUrls?: number;
  maxDepth?: number;
  personas?: string[];
};

export type FixtureRequirement = {
  kind: string;
  parameters?: Record<string, unknown>;
};

export type FixtureLease = {
  id: string;
  requirement: FixtureRequirement;
  expiresAt?: string;
};

export type WorkflowCandidate = {
  workflow: Workflow;
  neighborhood?: EvidenceRef[];
};

export type RuntimeContext = {
  runId: string;
  revision: SourceRevision;
  environment: { class: string; origin?: string; featureFlags?: string[] };
  persona?: string;
};

export type VerificationPolicy = {
  requiredRuns: number;
  forbidNetworkErrors: boolean;
  screenshotCheckpoints?: string[];
  trace?: 'retain' | 'discard';
};

export type PlanResult = {
  intent: string;
  steps: Array<{ intent: string; actionClass: ActionClass }>;
  evidenceRefs?: EvidenceRef[];
};

export type StagedBundle = {
  manifest: BundleManifest;
  workflow: Workflow;
  evidenceIndex: EvidenceIndex;
  artifacts: ArtifactRef[];
  plan: string;
};

export type VerificationResult = {
  outcome: TruthState;
  diagnostics: Diagnostic[];
  artifacts: ArtifactRef[];
  runs: Array<{ passed: boolean }>;
};

export type GateResult = {
  gate: string;
  passed: boolean;
  diagnostics?: Diagnostic[];
};

export type PromotionReceipt = {
  manifest: BundleManifest;
  promotedAt: string;
  location: string;
  checksumSha256: string;
};

export interface SourceIndexer {
  index(input: SourceIndexRequest): AsyncIterable<EvidenceEvent>;
}
export interface SurfaceDiscoverer {
  discover(input: DiscoveryRequest): AsyncIterable<EvidenceEvent>;
}
export interface FixtureProvider {
  supports(requirement: FixtureRequirement): boolean;
  provision(requirement: FixtureRequirement): Promise<FixtureLease>;
  reset(lease: FixtureLease): Promise<void>;
  release(lease: FixtureLease): Promise<void>;
}
export interface WorkflowPlanner {
  plan(candidate: WorkflowCandidate, context: RuntimeContext): Promise<PlanResult>;
}
export interface WorkflowCompiler {
  compile(workflow: Workflow, observations: EvidenceRef[]): Promise<StagedBundle>;
}
export interface WorkflowVerifier {
  verify(bundle: StagedBundle, policy: VerificationPolicy): Promise<VerificationResult>;
}
export interface BundlePromoter {
  promote(bundle: StagedBundle, gates: GateResult[]): Promise<PromotionReceipt>;
}
