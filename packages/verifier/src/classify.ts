import type { Diagnostic, TruthState, VerificationPolicy } from '@arxic/contracts';
import {
  ARXIC_VERIFY_APP_DEFECT,
  ARXIC_VERIFY_ARTIFACT_HASH_MISMATCH,
  ARXIC_VERIFY_ARTIFACT_MISSING,
  ARXIC_VERIFY_BLOCKED_NETWORK,
  ARXIC_VERIFY_FLAKY_RUNS,
  ARXIC_VERIFY_REDACTION_FAILED,
  ARXIC_VERIFY_RUN_FAILURE,
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
  /** Redacted per-run failure summaries for failed runs (#258 evidence retention). */
  runFailures?: string[];
  networkErrors?: string[];
  receiptFailures?: string[];
  receiptRedactionFailures?: string[];
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
  const passed = input.runs.filter((run) => run.passed).length;
  if (input.policy.forbidNetworkErrors !== false && input.networkErrors?.length) {
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
  if (input.receiptFailures?.length) {
    return {
      outcome: 'blocked',
      diagnostics: [
        verifyDiagnostic(
          ARXIC_VERIFY_TRANSITIONS_MISSING,
          'blocked',
          input.subject,
          `Transition receipts failed closed: ${input.receiptFailures.join('; ')}`,
        ),
      ],
    };
  }
  if (input.receiptRedactionFailures?.length) {
    return {
      outcome: 'blocked',
      diagnostics: [
        verifyDiagnostic(
          ARXIC_VERIFY_REDACTION_FAILED,
          'blocked',
          input.subject,
          `Transition receipt redaction failed: ${input.receiptRedactionFailures.join('; ')}`,
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
  // #258: real run failures classify BEFORE the artifact gate. A failed run
  // structurally produces no checkpoint screenshots, so the screenshot
  // inventory gate fails as a consequence — reporting it INSTEAD of the run
  // cause masked genuine app defects behind ARXIC-VERIFY-ARTIFACT-MISSING.
  // The artifact-gate failure is now appended ALONGSIDE the honest cause.
  const runOutcome = runOutcomeClassification(input, passed);
  if (runOutcome) {
    return {
      outcome: runOutcome.outcome,
      diagnostics: [
        runOutcome.diagnostic,
        ...runFailureDiagnostics(input),
        ...artifactFailureDiagnostics(input),
      ],
    };
  }
  if (input.artifactFailures?.length) {
    return {
      outcome: 'blocked',
      diagnostics: [artifactFailureDiagnostics(input)].flat(),
    };
  }
  return { outcome: 'verified', diagnostics: [] };
}

function runOutcomeClassification(
  input: ClassificationInput,
  passed: number,
): { outcome: 'contradicted'; diagnostic: Diagnostic } | undefined {
  if (passed > 0 && passed < input.runs.length) {
    return {
      outcome: 'contradicted',
      diagnostic: verifyDiagnostic(
        ARXIC_VERIFY_FLAKY_RUNS,
        'contradicted',
        input.subject,
        'Verification split between passing and failing clean-fixture runs',
      ),
    };
  }
  if (input.runs.length > 0 && passed === 0) {
    return {
      outcome: 'contradicted',
      diagnostic: verifyDiagnostic(
        ARXIC_VERIFY_APP_DEFECT,
        'contradicted',
        input.subject,
        'Runtime disproved the candidate in every clean-fixture run',
      ),
    };
  }
  return undefined;
}

function runFailureDiagnostics(input: ClassificationInput): Diagnostic[] {
  return (input.runFailures ?? []).map((evidence) =>
    verifyDiagnostic(ARXIC_VERIFY_RUN_FAILURE, 'contradicted', input.subject, evidence),
  );
}

function artifactFailureDiagnostics(input: ClassificationInput): Diagnostic[] {
  if (!input.artifactFailures?.length) return [];
  const mismatch = input.artifactFailures.some(({ reason }) => reason === 'mismatch');
  return [
    verifyDiagnostic(
      mismatch ? ARXIC_VERIFY_ARTIFACT_HASH_MISMATCH : ARXIC_VERIFY_ARTIFACT_MISSING,
      'blocked',
      input.subject,
      `Verification artifacts failed the gate: ${input.artifactFailures.map(({ detail }) => detail).join('; ')}`,
    ),
  ];
}
