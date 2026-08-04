import { validateDiagnostic, type Diagnostic } from '@arxic/contracts';

export const ARXIC_POLICY_ORIGIN_DENIED = 'ARXIC-POLICY-ORIGIN-DENIED' as const;
export const ARXIC_POLICY_DESTRUCTIVE_WITHOUT_APPROVAL =
  'ARXIC-POLICY-DESTRUCTIVE-WITHOUT-APPROVAL' as const;
export const ARXIC_POLICY_EXTERNAL_WITHOUT_SANDBOX =
  'ARXIC-POLICY-EXTERNAL-WITHOUT-SANDBOX' as const;
export const ARXIC_POLICY_EXTERNAL_WITHOUT_APPROVAL =
  'ARXIC-POLICY-EXTERNAL-WITHOUT-APPROVAL' as const;
export const ARXIC_POLICY_BUDGET_EXHAUSTED = 'ARXIC-POLICY-BUDGET-EXHAUSTED' as const;
export const ARXIC_POLICY_BUDGET_MISSING = 'ARXIC-POLICY-BUDGET-MISSING' as const;
export const ARXIC_POLICY_LEASE_COLLISION = 'ARXIC-POLICY-LEASE-COLLISION' as const;
export const ARXIC_POLICY_LEASE_MISSING = 'ARXIC-POLICY-LEASE-MISSING' as const;
export const ARXIC_POLICY_LEASE_EXPIRED = 'ARXIC-POLICY-LEASE-EXPIRED' as const;
export const ARXIC_POLICY_UNKNOWN_ACTION = 'ARXIC-POLICY-UNKNOWN-ACTION' as const;
export const ARXIC_POLICY_INVARIANT_VIOLATION = 'ARXIC-POLICY-INVARIANT-VIOLATION' as const;

export const POLICY_DIAGNOSTIC_CODES = Object.freeze([
  ARXIC_POLICY_ORIGIN_DENIED,
  ARXIC_POLICY_DESTRUCTIVE_WITHOUT_APPROVAL,
  ARXIC_POLICY_EXTERNAL_WITHOUT_SANDBOX,
  ARXIC_POLICY_EXTERNAL_WITHOUT_APPROVAL,
  ARXIC_POLICY_BUDGET_EXHAUSTED,
  ARXIC_POLICY_BUDGET_MISSING,
  ARXIC_POLICY_LEASE_COLLISION,
  ARXIC_POLICY_LEASE_MISSING,
  ARXIC_POLICY_LEASE_EXPIRED,
  ARXIC_POLICY_UNKNOWN_ACTION,
  ARXIC_POLICY_INVARIANT_VIOLATION,
] as const);

export type PolicyDiagnosticCode = (typeof POLICY_DIAGNOSTIC_CODES)[number];

export function isPolicyDiagnosticCode(code: string): code is PolicyDiagnosticCode {
  return (POLICY_DIAGNOSTIC_CODES as readonly string[]).includes(code);
}

export function policyDiagnostic(
  code: PolicyDiagnosticCode,
  subject: string,
  message: string,
): Diagnostic {
  const diagnostic: Diagnostic = { code, severity: 'blocked', subject, message };
  if (!validateDiagnostic(diagnostic).ok) {
    throw new Error(`Manufactured invalid policy diagnostic: ${code}`);
  }
  return diagnostic;
}
