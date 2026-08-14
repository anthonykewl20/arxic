import type { Diagnostic, DiagnosticSeverity } from '@arxic/contracts';
import { validateDiagnostic } from '@arxic/contracts';

export const ARXIC_EXIT_PREFLIGHT_FAILED = 'ARXIC-EXIT-PREFLIGHT-FAILED' as const;
export const ARXIC_EXIT_EVIDENCE_GATE_BLOCKED = 'ARXIC-EXIT-EVIDENCE-GATE-BLOCKED' as const;
export const ARXIC_EXIT_COMPILE_FAILED = 'ARXIC-EXIT-COMPILE-FAILED' as const;
export const ARXIC_EXIT_PROMOTION_SKIPPED = 'ARXIC-EXIT-PROMOTION-SKIPPED' as const;

export const EXIT_DIAGNOSTIC_CODES = [
  ARXIC_EXIT_PREFLIGHT_FAILED,
  ARXIC_EXIT_EVIDENCE_GATE_BLOCKED,
  ARXIC_EXIT_COMPILE_FAILED,
  ARXIC_EXIT_PROMOTION_SKIPPED,
] as const;

export function exitDiagnostic(
  code: (typeof EXIT_DIAGNOSTIC_CODES)[number],
  severity: DiagnosticSeverity,
  subject: string,
  message: string,
): Diagnostic {
  const diagnostic: Diagnostic = { code, severity, subject, message };
  if (!validateDiagnostic(diagnostic).ok) throw new Error('Invalid M0 exit diagnostic');
  return diagnostic;
}
