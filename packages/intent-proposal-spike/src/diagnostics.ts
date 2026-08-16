import { validateDiagnostic, type Diagnostic } from '@arxic/contracts';

/**
 * DG-04 spike diagnostics. Severity is always a non-`verified` truth state; a
 * proposal pipeline can never originate `verified` (ADR-001 §2 / ADR-008 §6).
 */
export const ARXIC_PROPOSAL_INVENTORY_REF_DANGLING =
  'ARXIC-PROPOSAL-INVENTORY-REF-DANGLING' as const;
export const ARXIC_PROPOSAL_EVIDENCE_REF_DANGLING = 'ARXIC-PROPOSAL-EVIDENCE-REF-DANGLING' as const;
export const ARXIC_PROPOSAL_DUPLICATE = 'ARXIC-PROPOSAL-DUPLICATE' as const;
export const ARXIC_PROPOSAL_BATCH_EMPTY = 'ARXIC-PROPOSAL-BATCH-EMPTY' as const;
export const ARXIC_PROPOSAL_RUN_BLOCKED = 'ARXIC-PROPOSAL-RUN-BLOCKED' as const;
export const ARXIC_PROPOSAL_SCALE_TARGET_MISSING = 'ARXIC-PROPOSAL-SCALE-TARGET-MISSING' as const;
export const ARXIC_PROPOSAL_ROW_LIMIT_EXCEEDED = 'ARXIC-PROPOSAL-ROW-LIMIT-EXCEEDED' as const;

export const PROPOSAL_DIAGNOSTIC_CODES = [
  ARXIC_PROPOSAL_INVENTORY_REF_DANGLING,
  ARXIC_PROPOSAL_EVIDENCE_REF_DANGLING,
  ARXIC_PROPOSAL_DUPLICATE,
  ARXIC_PROPOSAL_BATCH_EMPTY,
  ARXIC_PROPOSAL_RUN_BLOCKED,
  ARXIC_PROPOSAL_SCALE_TARGET_MISSING,
  ARXIC_PROPOSAL_ROW_LIMIT_EXCEEDED,
] as const;

export type ProposalDiagnosticCode = (typeof PROPOSAL_DIAGNOSTIC_CODES)[number];

export function proposalDiagnostic(
  code: ProposalDiagnosticCode,
  severity: Exclude<Diagnostic['severity'], 'verified'>,
  subject: string,
  message: string,
): Diagnostic {
  const diagnostic: Diagnostic = { code, severity, subject, message };
  if (!validateDiagnostic(diagnostic).ok) {
    throw new Error('intent-proposal-spike manufactured an invalid Diagnostic');
  }
  return diagnostic;
}
