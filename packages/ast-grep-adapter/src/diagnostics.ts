import type { Diagnostic, DiagnosticSeverity } from '@arxic/contracts';

export const ARXIC_RULES_SG_ERROR = 'ARXIC-RULES-SG-ERROR' as const;
export const ARXIC_RULES_PACK_INVALID = 'ARXIC-RULES-PACK-INVALID' as const;
export const ARXIC_RULES_CONFLICT = 'ARXIC-RULES-CONFLICT' as const;
export const ARXIC_RULES_FALLBACK = 'ARXIC-RULES-FALLBACK' as const;
export const ARXIC_RULES_CHAIN_INCOMPLETE = 'ARXIC-RULES-CHAIN-INCOMPLETE' as const;
export const ARXIC_RULES_DIRTY_TREE = 'ARXIC-RULES-DIRTY-TREE' as const;

export const RULES_DIAGNOSTIC_CODES = [
  ARXIC_RULES_SG_ERROR,
  ARXIC_RULES_PACK_INVALID,
  ARXIC_RULES_CONFLICT,
  ARXIC_RULES_FALLBACK,
  ARXIC_RULES_CHAIN_INCOMPLETE,
  ARXIC_RULES_DIRTY_TREE,
] as const;

export type RulesDiagnosticCode = (typeof RULES_DIAGNOSTIC_CODES)[number];

export function rulesDiagnostic(
  code: RulesDiagnosticCode,
  subject: string,
  message: string,
  severity: DiagnosticSeverity = 'blocked',
): Diagnostic {
  return { code, severity, subject, message };
}
