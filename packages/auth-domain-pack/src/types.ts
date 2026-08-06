import type {
  Diagnostic,
  EvidenceRef,
  StagedBundle,
  TruthState,
  VerificationResult,
  Workflow,
} from '@arxic/contracts';
import type { VerificationPersona } from '@arxic/verifier';

export type FixtureBlocker = {
  fixture: 'inbox' | 'totp';
  reason: string;
};

export type AuthCandidate = {
  workflow: Workflow;
  fixtureBlocker?: FixtureBlocker;
};

export type AuthDomainPackOptions = {
  origin: string;
  outputDirectory: string;
  artifactsDir: string;
  persona: VerificationPersona;
  resetAndSeed?: (run: number) => Promise<void>;
  now?: () => string;
};

export type WorkflowResult = {
  id: string;
  title: string;
  outcome: TruthState;
  diagnostics: Diagnostic[];
  bundle?: StagedBundle;
  verification?: VerificationResult;
};

export type DomainManifest = {
  schemaVersion: 1;
  domain: 'authentication';
  generatedAt: string;
  generator: { id: '@arxic/auth-domain-pack'; version: '0.0.0' };
  workflowCount: number;
  verified: number;
  blocked: number;
  contradicted: number;
};

export type CoverageRow = {
  workflowId: string;
  title: string;
  outcome: TruthState;
  staticEvidence: number;
  runtimeEvidence: number;
  blockerReason?: string;
};

export type CoverageMatrix = {
  denominator: number;
  rows: CoverageRow[];
};

export type DomainPack = {
  manifest: DomainManifest;
  coverageMatrix: CoverageMatrix;
  workflows: WorkflowResult[];
};

export type AuthCompiler = {
  compile(workflow: Workflow, observations: EvidenceRef[]): Promise<StagedBundle>;
};

export type AuthVerifier = {
  verify(bundle: StagedBundle, policy: Workflow['verification']): Promise<VerificationResult>;
};

export type AuthDomainPackDependencies = {
  compiler?: (outputDirectory: string) => AuthCompiler;
  verifier?: (outputDirectory: string) => AuthVerifier;
};
