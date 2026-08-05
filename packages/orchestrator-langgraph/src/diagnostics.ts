import type { Diagnostic, DiagnosticSeverity } from '@arxic/contracts';
import { validateDiagnostic } from '@arxic/contracts';

export const ARXIC_ORCH_RESUME = 'ARXIC-ORCH-RESUME' as const;
export const ARXIC_ORCH_EMPTY_COVERAGE = 'ARXIC-ORCH-EMPTY-COVERAGE' as const;
export const ARXIC_ORCH_MODEL_RETRIES = 'ARXIC-ORCH-MODEL-RETRIES' as const;
export const ARXIC_ORCH_HASH_MISMATCH = 'ARXIC-ORCH-HASH-MISMATCH' as const;
export const ARXIC_ORCH_STAGE_BLOCKED = 'ARXIC-ORCH-STAGE-BLOCKED' as const;
export const ARXIC_ORCH_REDACTION_FAILED = 'ARXIC-ORCH-REDACTION-FAILED' as const;

export const ORCH_DIAGNOSTIC_CODES = [
  ARXIC_ORCH_RESUME,
  ARXIC_ORCH_EMPTY_COVERAGE,
  ARXIC_ORCH_MODEL_RETRIES,
  ARXIC_ORCH_HASH_MISMATCH,
  ARXIC_ORCH_STAGE_BLOCKED,
  ARXIC_ORCH_REDACTION_FAILED,
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
