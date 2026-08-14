import type { Diagnostic, DiagnosticSeverity } from '@arxic/contracts';
import { validateDiagnostic } from '@arxic/contracts';

export const ARXIC_ORCH_RESUME = 'ARXIC-ORCH-RESUME' as const;
export const ARXIC_ORCH_EMPTY_COVERAGE = 'ARXIC-ORCH-EMPTY-COVERAGE' as const;
export const ARXIC_ORCH_MODEL_RETRIES = 'ARXIC-ORCH-MODEL-RETRIES' as const;
export const ARXIC_ORCH_INFERENCE_ERROR = 'ARXIC-ORCH-INFERENCE-ERROR' as const;
export const ARXIC_ORCH_HASH_MISMATCH = 'ARXIC-ORCH-HASH-MISMATCH' as const;
export const ARXIC_ORCH_STAGE_BLOCKED = 'ARXIC-ORCH-STAGE-BLOCKED' as const;
export const ARXIC_ORCH_REDACTION_FAILED = 'ARXIC-ORCH-REDACTION-FAILED' as const;
export const ARXIC_ORCH_ORACLE_RESOLVED = 'ARXIC-ORCH-ORACLE-RESOLVED' as const;
export const ARXIC_ORCH_ORACLE_UNMATCHED = 'ARXIC-ORCH-ORACLE-UNMATCHED' as const;
export const ARXIC_ORCH_INPUT_FINGERPRINT_MISMATCH =
  'ARXIC-ORCH-INPUT-FINGERPRINT-MISMATCH' as const;
export const ARXIC_ORCH_INPUT_FINGERPRINT_MISSING = 'ARXIC-ORCH-INPUT-FINGERPRINT-MISSING' as const;
export const ARXIC_ORCH_INPUT_FINGERPRINT_INVALID = 'ARXIC-ORCH-INPUT-FINGERPRINT-INVALID' as const;

export const ORCH_DIAGNOSTIC_CODES = [
  ARXIC_ORCH_RESUME,
  ARXIC_ORCH_EMPTY_COVERAGE,
  ARXIC_ORCH_MODEL_RETRIES,
  ARXIC_ORCH_INFERENCE_ERROR,
  ARXIC_ORCH_HASH_MISMATCH,
  ARXIC_ORCH_STAGE_BLOCKED,
  ARXIC_ORCH_REDACTION_FAILED,
  ARXIC_ORCH_ORACLE_RESOLVED,
  ARXIC_ORCH_ORACLE_UNMATCHED,
  ARXIC_ORCH_INPUT_FINGERPRINT_MISMATCH,
  ARXIC_ORCH_INPUT_FINGERPRINT_MISSING,
  ARXIC_ORCH_INPUT_FINGERPRINT_INVALID,
] as const;

export type OrchDiagnosticCode = (typeof ORCH_DIAGNOSTIC_CODES)[number];

export function orchDiagnostic(
  code: OrchDiagnosticCode,
  severity: DiagnosticSeverity,
  subject: string,
  message: string,
): Diagnostic {
  const diagnostic: Diagnostic = { code, severity, subject, message };
  if (!validateDiagnostic(diagnostic).ok) throw new Error('Invalid orchestrator diagnostic');
  return diagnostic;
}
