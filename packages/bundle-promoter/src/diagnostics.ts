import type { Diagnostic } from '@arxic/contracts';
import { validateDiagnostic } from '@arxic/contracts';

export const ARXIC_PROMOTION_GATE_FAILED = 'ARXIC-PROMOTION-GATE-FAILED' as const;
export const ARXIC_PROMOTION_VALIDATION_FAILED = 'ARXIC-PROMOTION-VALIDATION-FAILED' as const;
export const ARXIC_PROMOTION_HASH_MISMATCH = 'ARXIC-PROMOTION-HASH-MISMATCH' as const;
export const ARXIC_PROMOTION_ATOMIC_REPLACE_FAILED =
  'ARXIC-PROMOTION-ATOMIC-REPLACE-FAILED' as const;
export const ARXIC_PROMOTION_LOCK_CONTENTION = 'ARXIC-PROMOTION-LOCK-CONTENTION' as const;
export const ARXIC_PROMOTION_FREEZE_FAILED = 'ARXIC-PROMOTION-FREEZE-FAILED' as const;
export const ARXIC_PROMOTION_REDACTION_FAILED = 'ARXIC-PROMOTION-REDACTION-FAILED' as const;

export const PROMOTION_DIAGNOSTIC_CODES = [
  ARXIC_PROMOTION_GATE_FAILED,
  ARXIC_PROMOTION_VALIDATION_FAILED,
  ARXIC_PROMOTION_HASH_MISMATCH,
  ARXIC_PROMOTION_ATOMIC_REPLACE_FAILED,
  ARXIC_PROMOTION_LOCK_CONTENTION,
  ARXIC_PROMOTION_FREEZE_FAILED,
  ARXIC_PROMOTION_REDACTION_FAILED,
] as const;

export type PromotionDiagnosticCode = (typeof PROMOTION_DIAGNOSTIC_CODES)[number];

export function promotionDiagnostic(
  code: PromotionDiagnosticCode,
  subject: string,
  message: string,
): Diagnostic {
  const diagnostic: Diagnostic = { code, severity: 'blocked', subject, message };
  if (!validateDiagnostic(diagnostic).ok) {
    throw new Error('bundle promoter manufactured invalid Diagnostic');
  }
  return diagnostic;
}
