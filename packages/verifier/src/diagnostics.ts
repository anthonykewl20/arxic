import type { Diagnostic, DiagnosticSeverity } from '@arxic/contracts';
import { validateDiagnostic } from '@arxic/contracts';

export const ARXIC_VERIFY_FLAKY_RUNS = 'ARXIC-VERIFY-FLAKY-RUNS' as const;
export const ARXIC_VERIFY_APP_DEFECT = 'ARXIC-VERIFY-APP-DEFECT' as const;
export const ARXIC_VERIFY_RUN_FAILURE = 'ARXIC-VERIFY-RUN-FAILURE' as const;
export const ARXIC_VERIFY_BLOCKED_FIXTURE = 'ARXIC-VERIFY-BLOCKED-FIXTURE' as const;
export const ARXIC_VERIFY_BLOCKED_NETWORK = 'ARXIC-VERIFY-BLOCKED-NETWORK' as const;
export const ARXIC_VERIFY_ARTIFACT_MISSING = 'ARXIC-VERIFY-ARTIFACT-MISSING' as const;
export const ARXIC_VERIFY_ARTIFACT_HASH_MISMATCH = 'ARXIC-VERIFY-ARTIFACT-HASH-MISMATCH' as const;
export const ARXIC_VERIFY_TRACE_SANITIZATION_FAILED =
  'ARXIC-VERIFY-TRACE-SANITIZATION-FAILED' as const;
export const ARXIC_VERIFY_TRANSITIONS_MISSING = 'ARXIC-VERIFY-TRANSITIONS-MISSING' as const;
export const ARXIC_VERIFY_SUITE_UNAVAILABLE = 'ARXIC-VERIFY-SUITE-UNAVAILABLE' as const;
export const ARXIC_VERIFY_SCREENSHOT_PRIVACY = 'ARXIC-VERIFY-SCREENSHOT-PRIVACY' as const;
export const ARXIC_VERIFY_REDACTION_FAILED = 'ARXIC-VERIFY-REDACTION-FAILED' as const;

export const ARXIC_VERIFY_DIAGNOSTIC_CODES = [
  ARXIC_VERIFY_FLAKY_RUNS,
  ARXIC_VERIFY_APP_DEFECT,
  ARXIC_VERIFY_RUN_FAILURE,
  ARXIC_VERIFY_BLOCKED_FIXTURE,
  ARXIC_VERIFY_BLOCKED_NETWORK,
  ARXIC_VERIFY_ARTIFACT_MISSING,
  ARXIC_VERIFY_ARTIFACT_HASH_MISMATCH,
  ARXIC_VERIFY_TRACE_SANITIZATION_FAILED,
  ARXIC_VERIFY_TRANSITIONS_MISSING,
  ARXIC_VERIFY_SUITE_UNAVAILABLE,
  ARXIC_VERIFY_SCREENSHOT_PRIVACY,
  ARXIC_VERIFY_REDACTION_FAILED,
] as const;

export type VerifyDiagnosticCode = (typeof ARXIC_VERIFY_DIAGNOSTIC_CODES)[number];

export function verifyDiagnostic(
  code: VerifyDiagnosticCode,
  severity: DiagnosticSeverity,
  subject: string,
  message: string,
): Diagnostic {
  const diagnostic: Diagnostic = { code, severity, subject, message };
  if (!validateDiagnostic(diagnostic).ok) throw new Error('Verifier made an invalid Diagnostic');
  return diagnostic;
}
