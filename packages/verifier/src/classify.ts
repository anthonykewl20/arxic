import type { Diagnostic, TruthState, VerificationPolicy } from '@arxic/contracts';
import {
  ARXIC_VERIFY_APP_DEFECT,
  ARXIC_VERIFY_ARTIFACT_HASH_MISMATCH,
  ARXIC_VERIFY_ARTIFACT_MISSING,
  ARXIC_VERIFY_BLOCKED_NETWORK,
  ARXIC_VERIFY_FLAKY_RUNS,
  ARXIC_VERIFY_SUITE_UNAVAILABLE,
  ARXIC_VERIFY_TRANSITIONS_MISSING,
  verifyDiagnostic,
} from './diagnostics';

export type ClassificationInput = {
  subject: string;
  runs: Array<{ passed: boolean }>;
  policy: VerificationPolicy;
  executionDiagnostics?: Diagnostic[];
  artifactFailures?: Array<{ reason: 'missing' | 'mismatch'; detail: string }>;
  networkErrors?: string[];
  missingTransitions?: string[];
};

export type Classification = { outcome: TruthState; diagnostics: Diagnostic[] };

export function classifyVerification(input: ClassificationInput): Classification {
  if (!Number.isInteger(input.policy.requiredRuns) || input.policy.requiredRuns < 1) {
    return {
      outcome: 'blocked',
      diagnostics: [
        verifyDiagnostic(
          ARXIC_VERIFY_SUITE_UNAVAILABLE,
          'blocked',
          input.subject,
          'Verification requires at least one clean-fixture run',
        ),
      ],
    };
  }
  if (input.executionDiagnostics?.length) {
    return { outcome: 'blocked', diagnostics: input.executionDiagnostics };
  }
  if (input.policy.forbidNetworkErrors && input.networkErrors?.length) {
    return {
      outcome: 'blocked',
      diagnostics: [
        verifyDiagnostic(
          ARXIC_VERIFY_BLOCKED_NETWORK,
          'blocked',
          input.subject,
          `Network or console errors violated verification policy: ${input.networkErrors.join(', ')}`,
        ),
      ],
    };
  }
  if (input.artifactFailures?.length) {
    const mismatch = input.artifactFailures.some(({ reason }) => reason === 'mismatch');
    return {
      outcome: 'blocked',
      diagnostics: [
        verifyDiagnostic(
          mismatch ? ARXIC_VERIFY_ARTIFACT_HASH_MISMATCH : ARXIC_VERIFY_ARTIFACT_MISSING,
          'blocked',
          input.subject,
          `Verification artifacts failed the gate: ${input.artifactFailures.map(({ detail }) => detail).join('; ')}`,
        ),
      ],
    };
  }
  const passed = input.runs.filter((run) => run.passed).length;
  if (passed > 0 && passed < input.runs.length) {
    return {
      outcome: 'contradicted',
      diagnostics: [
        verifyDiagnostic(
          ARXIC_VERIFY_FLAKY_RUNS,
          'contradicted',
          input.subject,
          'Verification split between passing and failing clean-fixture runs',
        ),
      ],
    };
  }
  if (input.runs.length > 0 && passed === 0) {
    return {
      outcome: 'contradicted',
      diagnostics: [
        verifyDiagnostic(
          ARXIC_VERIFY_APP_DEFECT,
          'contradicted',
          input.subject,
          'Runtime disproved the candidate in every clean-fixture run',
        ),
      ],
    };
  }
  if (input.missingTransitions?.length) {
    return {
      outcome: 'blocked',
      diagnostics: [
        verifyDiagnostic(
          ARXIC_VERIFY_TRANSITIONS_MISSING,
          'blocked',
          input.subject,
          `Required transitions were not observed: ${input.missingTransitions.join(', ')}`,
        ),
      ],
    };
  }
  if (input.runs.length !== input.policy.requiredRuns) {
    return {
      outcome: 'blocked',
      diagnostics: [
        verifyDiagnostic(
          ARXIC_VERIFY_SUITE_UNAVAILABLE,
          'blocked',
          input.subject,
          `Verification completed ${input.runs.length} of ${input.policy.requiredRuns} required runs`,
        ),
      ],
    };
  }
  return { outcome: 'verified', diagnostics: [] };
}
