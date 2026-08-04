import type { ActionClass } from '@arxic/contracts';
import { authorize, type PolicyAuthorization } from './policy';

export type { ActionClass, TruthState } from '@arxic/contracts';
export {
  ACTION_REGISTRY,
  approvalKey,
  authorize,
  type BudgetState,
  type HumanApproval,
  type PolicyAuthorization,
  type PolicyDecision,
} from './policy';
export { detectCollision, type LeaseState } from './lease';
export { ARXIC_POLICY_VERSION, computePolicySnapshot, type PolicySnapshot } from './snapshot';
export {
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
  POLICY_DIAGNOSTIC_CODES,
  isPolicyDiagnosticCode,
  policyDiagnostic,
  type PolicyDiagnosticCode,
} from './diagnostics';

export const PACKAGE_NAME = '@arxic/policy-engine' as const;

export type PolicyEngineConfig = {
  allowedOrigins: string[];
  policyVersion?: string;
  sandboxAdapterPresent?: boolean;
};

export type PolicyActionRequest = {
  action: string;
  actionClass: ActionClass;
  origin: string;
  lease?: import('./lease').LeaseState;
  approvals: Record<string, import('./policy').HumanApproval>;
  budget?: import('./policy').BudgetState;
};

export class PolicyEngine {
  readonly #config: PolicyEngineConfig;

  constructor(config: PolicyEngineConfig) {
    this.#config = {
      ...config,
      allowedOrigins: [...config.allowedOrigins],
    };
  }

  decide(request: PolicyActionRequest): import('./policy').PolicyDecision {
    const input: PolicyAuthorization = {
      ...request,
      allowedOrigins: [...this.#config.allowedOrigins],
      ...(this.#config.policyVersion === undefined
        ? {}
        : { policyVersion: this.#config.policyVersion }),
      ...(this.#config.sandboxAdapterPresent === undefined
        ? {}
        : { sandboxAdapterPresent: this.#config.sandboxAdapterPresent }),
    };
    return authorize(input);
  }
}
