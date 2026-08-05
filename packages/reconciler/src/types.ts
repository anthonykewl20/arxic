import type { Diagnostic, TruthState, Workflow } from '@arxic/contracts';

export type ReconciliationCandidate = Readonly<{
  id: string;
  title: string;
  evidenceRefs: readonly string[];
  workflow?: Workflow;
}>;

export type ReconciliationOutcome = Exclude<TruthState, 'verified'>;

export type CoverageRow = Readonly<{
  candidateId: string;
  staticEvidence: number;
  runtimeEvidence: number;
  outcome: ReconciliationOutcome;
  kind: 'candidate' | 'runtime-only';
  revision?: string;
  build?: string;
  domain?: string;
  feature?: string;
  persona?: string;
  role?: string;
  route?: string;
  preconditions?: readonly string[];
  pathKind?: 'happy' | 'sad' | 'admin' | 'unspecified';
  featureFlags?: readonly string[];
  browser?: string;
  staticStatus: 'asserted' | 'absent';
  runtimeReachability: 'observed' | 'unobserved' | 'blocked';
  verificationStatus: ReconciliationOutcome;
  blockerReason?: string;
  accountability: number;
  diagnostics: readonly Diagnostic[];
}>;

export type CoverageSummary = Readonly<{
  candidateAccountability: number;
  verifiedTransitionCoverage: 0;
  sourceEvidenceOverlap: number;
  runtimeEvidenceOverlap: number;
  uncovered: number;
  blocked: number;
  contradicted: number;
}>;

export type ReconciliationResult = Readonly<{
  denominator: number;
  rows: readonly CoverageRow[];
  orderedCandidates: readonly ReconciliationCandidate[];
  diagnostics: readonly Diagnostic[];
  summary: CoverageSummary;
}>;
