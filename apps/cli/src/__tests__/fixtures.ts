import type { Diagnostic } from '@arxic/contracts';
import type { RunState } from '@arxic/orchestrator-langgraph';
import type { ArxicConfig } from '@arxic/worker';

export const VALID_YAML = `version: 1
source:
  repository: .
  revision: HEAD
  languages: [typescript, javascript]
scope:
  domains: [authentication]
  frameworks: [nextjs, react, express]
  browsers: [chromium]
  personas: [anonymous, registered-user]
  featureFlags: { password-reset: true, mfa: true }
target:
  origin: http://127.0.0.1:1
  environmentClass: local-test
  attestationPath: /.well-known/arxic-test-target.json
  allowedOrigins:
    - http://127.0.0.1:1
    - http://127.0.0.1:2
policy:
  maxUrls: 250
  maxDepth: 8
  maxRuntimeMinutes: 30
  mutation: leased-fixtures-only
  externalNetwork: deny
  requiredVerificationRuns: 2
  screenshots: transition-checkpoints
  trace: retain
  humanApproval: [destructive, external-side-effect]
fixtures:
  inbox: captured-mail-sink
  otp: test-otp
  personaProvisioner: app-seed-api
models:
  provider: configured-adapter
  sourceRetention: disabled
`;

export const VALID_CONFIG: ArxicConfig = {
  version: 1,
  source: { repository: '.', revision: 'HEAD', languages: ['typescript', 'javascript'] },
  scope: {
    domains: ['authentication'],
    frameworks: ['nextjs', 'react', 'express'],
    browsers: ['chromium'],
    personas: ['anonymous', 'registered-user'],
    featureFlags: { 'password-reset': true, mfa: true },
  },
  target: {
    origin: 'http://127.0.0.1:1',
    environmentClass: 'local-test',
    attestationPath: '/.well-known/arxic-test-target.json',
    allowedOrigins: ['http://127.0.0.1:1', 'http://127.0.0.1:2'],
  },
  policy: {
    maxUrls: 250,
    maxDepth: 8,
    maxRuntimeMinutes: 30,
    mutation: 'leased-fixtures-only',
    externalNetwork: 'deny',
    requiredVerificationRuns: 2,
    screenshots: 'transition-checkpoints',
    trace: 'retain',
    humanApproval: ['destructive', 'external-side-effect'],
  },
  fixtures: {
    inbox: 'captured-mail-sink',
    otp: 'test-otp',
    personaProvisioner: 'app-seed-api',
  },
  models: { provider: 'configured-adapter', sourceRetention: 'disabled' },
};

export const OBSERVED_DIAGNOSTIC: Diagnostic = {
  code: 'ARXIC-ORCH-TEST-OBSERVED',
  severity: 'observed',
  subject: 'run:test-run',
  message: 'A deterministic test event was observed',
};

export function runState(
  diagnostics: readonly Diagnostic[] = [OBSERVED_DIAGNOSTIC],
  outcome: RunState['outcome'] = 'observed',
): RunState {
  return {
    runId: 'test-run',
    status: 'completed',
    outcome,
    completedStages: [0],
    artifacts: {
      0: { id: 'stage:0', sha256: 'a'.repeat(64) },
    },
    checkpoints: [
      {
        stage: 0,
        name: 'attestation',
        status: 'completed',
        startedAt: '2026-08-07T10:00:00.000Z',
        finishedAt: '2026-08-07T10:00:01.000Z',
        adapter: { name: '@arxic/environment', version: '0.0.0' },
        orchestratorVersion: '0.0.0',
        artifacts: [{ id: 'stage:0', sha256: 'a'.repeat(64) }],
        toolVersions: { node: '22.0.0', chromium: '1.2.3' },
        decisions: ['target attestation accepted'],
        approvals: ['owner approved local target'],
        gateResults: [{ gate: 'attestation', passed: true }],
        redaction: { passed: true, redactedFields: ['request.authorization'] },
      },
    ],
    diagnostics,
    promotionEligible: false,
  };
}
