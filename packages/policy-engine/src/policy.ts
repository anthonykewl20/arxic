import type { ActionClass, Diagnostic, TruthState } from '@arxic/contracts';
import {
  ARXIC_POLICY_BUDGET_EXHAUSTED,
  ARXIC_POLICY_BUDGET_MISSING,
  ARXIC_POLICY_DESTRUCTIVE_WITHOUT_APPROVAL,
  ARXIC_POLICY_EXTERNAL_WITHOUT_APPROVAL,
  ARXIC_POLICY_EXTERNAL_WITHOUT_SANDBOX,
  ARXIC_POLICY_INVARIANT_VIOLATION,
  ARXIC_POLICY_LEASE_COLLISION,
  ARXIC_POLICY_LEASE_EXPIRED,
  ARXIC_POLICY_LEASE_MISSING,
  ARXIC_POLICY_ORIGIN_DENIED,
  ARXIC_POLICY_UNKNOWN_ACTION,
  policyDiagnostic,
  type PolicyDiagnosticCode,
} from './diagnostics';
import type { LeaseState } from './lease';
import { ARXIC_POLICY_VERSION, computePolicySnapshot, type PolicySnapshot } from './snapshot';

export type HumanApproval = {
  approver: string;
  approvedAt: string;
  reason: string;
};

export type BudgetState = { remaining: number };

export type { LeaseState } from './lease';

export type PolicyAuthorization = {
  action: string;
  actionClass: ActionClass;
  origin: string;
  lease?: LeaseState;
  approvals: Record<string, HumanApproval>;
  allowedOrigins: string[];
  budget?: BudgetState;
  sandboxAdapterPresent?: boolean;
  policyVersion?: string;
  /** Action-owned clock for deterministic replay of time-bounded leases. */
  now?: number;
};

export type PolicyDecision = {
  decision: 'allow' | 'deny';
  truthState: TruthState;
  reason: string;
  diagnostics: Diagnostic[];
  snapshot: PolicySnapshot;
};

export const ACTION_REGISTRY: Readonly<Record<string, ActionClass>> = Object.freeze({
  navigation: 'read-only',
  'form-submit': 'reversible-mutation',
  'fixture-change': 'reversible-mutation',
  'file-write': 'external-side-effect',
  promotion: 'destructive',
  'delete-user': 'destructive',
});

export function approvalKey(action: string, origin: string): string {
  return `${action}:${origin}`;
}

function recordedApproval(input: PolicyAuthorization): HumanApproval | undefined {
  const key = approvalKey(input.action, input.origin);
  return Object.hasOwn(input.approvals, key) ? input.approvals[key] : undefined;
}

function isHumanApproval(value: unknown): value is HumanApproval {
  if (typeof value !== 'object' || value === null) return false;
  const approval = value as Record<string, unknown>;
  return (
    typeof approval.approver === 'string' &&
    approval.approver.length > 0 &&
    typeof approval.approvedAt === 'string' &&
    approval.approvedAt.length > 0 &&
    typeof approval.reason === 'string' &&
    approval.reason.length > 0
  );
}

function decisionFor(input: PolicyAuthorization, diagnostic?: Diagnostic): PolicyDecision {
  const decision = diagnostic ? 'deny' : 'allow';
  const resolvedPolicyVersion = input.policyVersion ?? ARXIC_POLICY_VERSION;
  return {
    decision,
    truthState: diagnostic ? 'blocked' : 'observed',
    reason: diagnostic?.message ?? `Policy authorized action: ${input.action}`,
    diagnostics: diagnostic ? [diagnostic] : [],
    snapshot: computePolicySnapshot(input, decision, resolvedPolicyVersion, () =>
      new Date(input.now ?? Date.now()).toISOString(),
    ),
  };
}

export function authorize(input: PolicyAuthorization): PolicyDecision {
  const deny = (code: PolicyDiagnosticCode, message: string): PolicyDecision =>
    decisionFor(input, policyDiagnostic(code, input.action, message));
  const registeredClass = Object.hasOwn(ACTION_REGISTRY, input.action)
    ? ACTION_REGISTRY[input.action]
    : undefined;

  if (registeredClass === undefined) {
    return deny(ARXIC_POLICY_UNKNOWN_ACTION, `Unknown policy action: ${input.action}`);
  }
  if (input.actionClass === undefined || input.actionClass !== registeredClass) {
    return deny(
      ARXIC_POLICY_INVARIANT_VIOLATION,
      `Action class does not match the registry for action: ${input.action}`,
    );
  }
  if (!input.allowedOrigins.includes(input.origin)) {
    return deny(ARXIC_POLICY_ORIGIN_DENIED, `Origin is not allowed for action: ${input.action}`);
  }

  if (registeredClass === 'read-only') {
    if (input.budget === undefined) {
      return deny(ARXIC_POLICY_BUDGET_MISSING, `Budget is required for action: ${input.action}`);
    }
    if (input.budget.remaining <= 0) {
      return deny(ARXIC_POLICY_BUDGET_EXHAUSTED, `Budget is exhausted for action: ${input.action}`);
    }
  }

  if (registeredClass === 'reversible-mutation') {
    if (input.lease === undefined) {
      return deny(ARXIC_POLICY_LEASE_MISSING, `Lease is required for action: ${input.action}`);
    }
    if (input.lease.inUse === true) {
      return deny(ARXIC_POLICY_LEASE_COLLISION, `Lease is in use for action: ${input.action}`);
    }
    const expiresAt = new Date(input.lease.expiresAt).getTime();
    const now = input.now ?? Date.now();
    if (!Number.isFinite(now) || Number.isNaN(expiresAt) || expiresAt <= now) {
      return deny(ARXIC_POLICY_LEASE_EXPIRED, `Lease is expired for action: ${input.action}`);
    }
    if (input.budget !== undefined && input.budget.remaining <= 0) {
      return deny(ARXIC_POLICY_BUDGET_EXHAUSTED, `Budget is exhausted for action: ${input.action}`);
    }
  }

  if (registeredClass === 'external-side-effect') {
    if (input.sandboxAdapterPresent !== true) {
      return deny(
        ARXIC_POLICY_EXTERNAL_WITHOUT_SANDBOX,
        `Sandbox adapter is required for action: ${input.action}`,
      );
    }
    const approval = recordedApproval(input);
    if (!isHumanApproval(approval)) {
      return deny(
        ARXIC_POLICY_EXTERNAL_WITHOUT_APPROVAL,
        `Recorded approval is required for external action: ${input.action}`,
      );
    }
    if (input.budget !== undefined && input.budget.remaining <= 0) {
      return deny(ARXIC_POLICY_BUDGET_EXHAUSTED, `Budget is exhausted for action: ${input.action}`);
    }
  }

  if (registeredClass === 'destructive') {
    const approval = recordedApproval(input);
    if (!isHumanApproval(approval)) {
      return deny(
        ARXIC_POLICY_DESTRUCTIVE_WITHOUT_APPROVAL,
        `Recorded approval is required for destructive action: ${input.action}`,
      );
    }
  }

  return decisionFor(input);
}
