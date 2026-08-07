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

export type CapabilityBlocker = { reason: string };

export type AuthCandidate = {
  workflow: Workflow;
  fixtureBlocker?: FixtureBlocker;
  capabilityBlocker?: CapabilityBlocker;
};

export type AuthCapabilityId =
  | 'authentication.login'
  | 'authentication.logout'
  | 'authentication.reset-request'
  | 'authentication.reset-complete'
  | 'authentication.password-change'
  | 'authentication.totp';

/**
 * Per-target-app observed auth surface. Candidates are derived from this evidence
 * rather than from hardcoded reference-app routes, so one pack produces sensible
 * candidates for structurally different apps. Per-app facts (the states the compiler
 * maps to routes, observed success assertions, and which capabilities an app supports)
 * belong in test data (`@arxic/real-world-testkit`); `authCandidates()` combines them
 * with app-agnostic auth domain knowledge and never branches on an app name.
 */
export type AuthSurface = {
  login: { entryState: string; successState: string; assertion: string };
  logout: { assertion: string };
  passwordChange:
    | { supported: true; state: string; assertion: string; routeAssertion: string }
    | { supported: false; reason: string };
  totp: { supported: true } | { supported: false; reason: string };
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
