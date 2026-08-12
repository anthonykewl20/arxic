import type { ActionClass, Diagnostic, EvidenceRef } from '@arxic/contracts';
import { validateDiagnostic } from '@arxic/contracts';
import {
  PlaywrightExplorationDriver,
  type ExplorationDriver,
  type LocatorPair,
  type LocatorResolution,
  type PlannedExplorationStep,
  type StepObservation,
} from '@arxic/playwright-agent-adapter';
import {
  approvalKey,
  PolicyEngine,
  type HumanApproval,
  type LeaseState,
} from '@arxic/policy-engine';
import type { ApprovalInput } from './orchestrator';
import type { Candidate, ExplorationResult, LocatorProvenanceRecord } from './types';

export const ARXIC_EXPLORATION_FORBIDDEN = 'ARXIC-EXPLORATION-FORBIDDEN' as const;
export const ARXIC_EXPLORATION_APPROVAL_DENIED = 'ARXIC-EXPLORATION-APPROVAL-DENIED' as const;
export const ARXIC_EXPLORATION_BUDGET_EXHAUSTED = 'ARXIC-EXPLORATION-BUDGET-EXHAUSTED' as const;
export const ARXIC_EXPLORATION_BUDGET_MISSING = 'ARXIC-EXPLORATION-BUDGET-MISSING' as const;
export const ARXIC_EXPLORATION_ORIGIN_DRIFT = 'ARXIC-EXPLORATION-ORIGIN-DRIFT' as const;
export const ARXIC_EXPLORATION_STEP_FAILED = 'ARXIC-EXPLORATION-STEP-FAILED' as const;
export const ARXIC_EXPLORATION_LOCATOR_AMBIGUOUS = 'ARXIC-EXPLORATION-LOCATOR-AMBIGUOUS' as const;
export const ARXIC_EXPLORATION_LOCATOR_INACCESSIBLE =
  'ARXIC-EXPLORATION-LOCATOR-INACCESSIBLE' as const;
export const ARXIC_EXPLORATION_LOCATOR_MISMATCH = 'ARXIC-EXPLORATION-LOCATOR-MISMATCH' as const;
export const ARXIC_EXPLORATION_TRANSITIONS_UNOBSERVED =
  'ARXIC-EXPLORATION-TRANSITIONS-UNOBSERVED' as const;

export const EXPLORATION_DIAGNOSTIC_CODES = Object.freeze([
  ARXIC_EXPLORATION_FORBIDDEN,
  ARXIC_EXPLORATION_APPROVAL_DENIED,
  ARXIC_EXPLORATION_BUDGET_EXHAUSTED,
  ARXIC_EXPLORATION_BUDGET_MISSING,
  ARXIC_EXPLORATION_ORIGIN_DRIFT,
  ARXIC_EXPLORATION_STEP_FAILED,
  ARXIC_EXPLORATION_LOCATOR_AMBIGUOUS,
  ARXIC_EXPLORATION_LOCATOR_INACCESSIBLE,
  ARXIC_EXPLORATION_LOCATOR_MISMATCH,
  ARXIC_EXPLORATION_TRANSITIONS_UNOBSERVED,
] as const);

export type ExplorationDiagnosticCode = (typeof EXPLORATION_DIAGNOSTIC_CODES)[number];

export function explorationDiagnostic(
  code: ExplorationDiagnosticCode,
  subject: string,
  message: string,
): Diagnostic {
  const diagnostic: Diagnostic = {
    code,
    severity: code === ARXIC_EXPLORATION_TRANSITIONS_UNOBSERVED ? 'observed' : 'blocked',
    subject,
    message,
  };
  if (!validateDiagnostic(diagnostic).ok)
    throw new Error('exploration orchestrator made an invalid Diagnostic');
  return diagnostic;
}

export type ExplorationIntentAction = string;

type PlanStepExecution =
  | Readonly<{ kind?: 'navigate' }>
  | Readonly<{ kind: 'snapshot' }>
  | Readonly<{ kind: 'fill'; locator: LocatorPair; value: string }>
  | Readonly<{ kind: 'click'; locator: LocatorPair }>;

export type PlanStep = Readonly<{
  intent: string;
  action: ExplorationIntentAction;
  actionClass: ActionClass;
  url?: string;
  required: boolean;
}> &
  PlanStepExecution;

export type ExplorationPlan = Readonly<{ steps: readonly PlanStep[] }>;

export type ExplorationInput = Readonly<{
  runId: string;
  origin: string;
  appBuildDigest?: string;
  candidates: readonly Candidate[];
  approval?: ApprovalInput;
  budget: number;
  sandboxAdapterPresent?: boolean;
  lease?: LeaseState;
  driver?: ExplorationDriver;
  browser?: string;
  now?: () => string;
}>;

export function planExploration(candidates: readonly Candidate[], origin: string): ExplorationPlan {
  const steps: PlanStep[] = [];
  for (const candidate of candidates) {
    if (!candidate.workflow) continue;
    const route = candidate.workflow.transitions
      .map((transition) => pathFromIntent(transition.action.intent))
      .find((path) => path !== undefined);
    if (route) {
      steps.push({
        intent: `observe route ${route}`,
        action: 'navigation',
        actionClass: 'read-only',
        url: new URL(route, origin).href,
        required: true,
      });
    }
    for (const transition of candidate.workflow.transitions) {
      const mapped = mapIntent(transition.action.intent, origin);
      steps.push({
        intent: transition.action.intent,
        action: mapped.action,
        actionClass: mapped.actionClass,
        ...(mapped.url ? { url: mapped.url } : {}),
        required: transition.required !== false,
      });
    }
  }
  return { steps };
}

export async function runExploration(input: ExplorationInput): Promise<ExplorationResult> {
  return runPlannedExploration(input);
}

export async function runPlannedExploration(
  input: ExplorationInput & Readonly<{ plan?: ExplorationPlan }>,
): Promise<ExplorationResult> {
  const plan = input.plan ?? planExploration(input.candidates, input.origin);
  if (plan.steps.length === 0) {
    return {
      approved: true,
      evidenceRefs: [],
      decisions: ['No exploration steps; nothing to observe'],
    };
  }
  if (
    input.plan === undefined &&
    plan.steps.every((step) => step.actionClass === 'reversible-mutation' && !step.url)
  ) {
    return {
      approved: true,
      evidenceRefs: [],
      decisions: ['No executable exploration steps; nothing to observe'],
    };
  }

  const engine = new PolicyEngine({
    allowedOrigins: [input.origin],
    sandboxAdapterPresent: input.sandboxAdapterPresent ?? false,
  });
  const approvals = approvalsFor(plan, input.approval, input.origin);
  const diagnostics: Diagnostic[] = [];
  const decisions: string[] = [];
  const evidenceRefs: EvidenceRef[] = [];
  const locatorProvenance: LocatorProvenanceRecord[] = [];
  const executable: PlanStep[] = [];
  let budgetRemaining = input.budget;
  let approved = true;
  let safeToExecute = true;

  for (const step of plan.steps) {
    if (budgetRemaining <= 0) {
      diagnostics.push(
        explorationDiagnostic(
          ARXIC_EXPLORATION_BUDGET_EXHAUSTED,
          step.intent,
          'Exploration budget was exhausted before the plan completed',
        ),
      );
      approved = false;
      break;
    }
    if (step.actionClass === 'reversible-mutation' && !input.lease) {
      decisions.push(
        `Step authorized but not executed (actionClass ${step.actionClass} requires fixtures/approval-handled): ${step.intent}`,
      );
      continue;
    }
    const decision = engine.decide({
      action: step.action,
      actionClass: step.actionClass,
      origin: input.origin,
      ...(input.lease ? { lease: input.lease } : {}),
      approvals,
      budget: { remaining: budgetRemaining },
    });
    if (decision.decision === 'deny') {
      const approvalDenied =
        (step.actionClass === 'external-side-effect' || step.actionClass === 'destructive') &&
        decision.reason.toLowerCase().includes('approval');
      diagnostics.push(
        explorationDiagnostic(
          approvalDenied ? ARXIC_EXPLORATION_APPROVAL_DENIED : ARXIC_EXPLORATION_FORBIDDEN,
          step.intent,
          decision.reason,
        ),
      );
      decisions.push(decision.reason);
      approved = false;
      safeToExecute = false;
      break;
    }
    if (isExecutableStep(step)) {
      executable.push(step);
      budgetRemaining -= 1;
    } else {
      decisions.push(
        `Step authorized but not executed (actionClass ${step.actionClass} requires fixtures/approval-handled): ${step.intent}`,
      );
    }
  }

  if (executable.length > 0 && safeToExecute) {
    const driver = input.driver ?? new PlaywrightExplorationDriver({ headless: true });
    try {
      const result = await driver.execute(executable.map(toDriverStep), {
        allowedOrigin: input.origin,
      });
      for (const [index, observation] of result.observations.entries()) {
        const step = executable[index];
        if (!step) continue;
        if (observation.locatorResolution) {
          locatorProvenance.push(
            toLocatorProvenanceRecord(step.intent, observation.locatorResolution),
          );
        }
        classifyObservation(observation, step, diagnostics, decisions);
        if (observation.originDrifted || (!observation.ok && step.required)) approved = false;
        if (
          observation.ok &&
          !observation.originDrifted &&
          observation.accessibilitySnapshotSha256
        ) {
          evidenceRefs.push({
            kind: 'runtime',
            runId: input.runId,
            appBuildDigest: input.appBuildDigest ?? '',
            browser: input.browser ?? 'chromium',
            browserVersion: observation.browserVersion ?? result.browserVersion ?? '',
            url: observation.url,
            timestamp: (input.now ?? (() => new Date().toISOString()))(),
            accessibilitySnapshotSha256: observation.accessibilitySnapshotSha256,
            ...(observation.screenshotRef ? { screenshotRef: observation.screenshotRef } : {}),
          });
          decisions.push(
            `Observed "${step.intent}" at ${observation.url} (a11y sha256 ${observation.accessibilitySnapshotSha256.slice(0, 12)})`,
          );
        }
      }
    } catch (error) {
      diagnostics.push(
        explorationDiagnostic(
          ARXIC_EXPLORATION_STEP_FAILED,
          'exploration-driver',
          error instanceof Error ? error.message : String(error),
        ),
      );
      approved = false;
    } finally {
      try {
        await driver.close();
      } catch (error) {
        diagnostics.push(
          explorationDiagnostic(
            ARXIC_EXPLORATION_STEP_FAILED,
            'exploration-driver-close',
            error instanceof Error ? error.message : String(error),
          ),
        );
        approved = false;
      }
    }
  }

  for (const step of plan.steps.filter((candidateStep) => candidateStep.required)) {
    if (!successfullyObserved(step, evidenceRefs)) {
      diagnostics.push(
        explorationDiagnostic(
          ARXIC_EXPLORATION_TRANSITIONS_UNOBSERVED,
          step.intent,
          `Required transition was not observed: ${step.intent}`,
        ),
      );
    }
  }
  decisions.push(...diagnostics.map(formatDiagnostic));
  return {
    approved,
    evidenceRefs,
    decisions,
    ...(locatorProvenance.length > 0 ? { locatorProvenance: { records: locatorProvenance } } : {}),
  };
}

export async function defaultExploration(input: ExplorationInput): Promise<ExplorationResult> {
  return runExploration(input);
}

function mapIntent(
  intent: string,
  origin: string,
): Readonly<{ action: ExplorationIntentAction; actionClass: ActionClass; url?: string }> {
  const path = pathFromIntent(intent);
  if (/navigate|visit|go to/i.test(intent)) {
    return {
      action: 'navigation',
      actionClass: 'read-only',
      ...(path ? { url: new URL(path, origin).href } : {}),
    };
  }
  if (/submit|login|form/i.test(intent))
    return { action: 'form-submit', actionClass: 'reversible-mutation' };
  if (/delete|remove|destroy/i.test(intent))
    return { action: 'delete-user', actionClass: 'destructive' };
  if (/file|write|upload/i.test(intent))
    return { action: 'file-write', actionClass: 'external-side-effect' };
  return {
    action: 'navigation',
    actionClass: 'read-only',
    ...(path ? { url: new URL(path, origin).href } : {}),
  };
}

function pathFromIntent(intent: string): string | undefined {
  return intent.match(/\/[\w/-]+/)?.[0];
}

function approvalsFor(
  plan: ExplorationPlan,
  approval: ApprovalInput | undefined,
  origin: string,
): Record<string, HumanApproval> {
  if (!approval) return {};
  const approvals: Record<string, HumanApproval> = {};
  for (const step of plan.steps) {
    if (step.actionClass === 'external-side-effect' || step.actionClass === 'destructive') {
      approvals[approvalKey(step.action, origin)] = approval;
    }
  }
  return approvals;
}

function toDriverStep(step: PlanStep): PlannedExplorationStep {
  switch (step.kind) {
    case 'fill':
      return {
        intent: step.intent,
        kind: 'fill',
        locator: step.locator,
        value: step.value,
        ...(step.url ? { url: step.url } : {}),
      };
    case 'click':
      return {
        intent: step.intent,
        kind: 'click',
        locator: step.locator,
        ...(step.url ? { url: step.url } : {}),
      };
    case 'snapshot':
      return { intent: step.intent, kind: 'snapshot' };
    case 'navigate':
    case undefined:
      if (!step.url) throw new Error(`Exploration step is not executable: ${step.intent}`);
      return { intent: step.intent, kind: 'navigate', url: step.url };
  }
}

function isExecutableStep(step: PlanStep): boolean {
  if (step.actionClass === 'read-only') {
    return step.kind === 'snapshot' || step.kind === 'navigate' || Boolean(step.url);
  }
  return (
    step.actionClass === 'reversible-mutation' && (step.kind === 'fill' || step.kind === 'click')
  );
}

function toLocatorProvenanceRecord(
  intent: string,
  resolution: LocatorResolution,
): LocatorProvenanceRecord {
  const locators = { semantic: resolution.semantic, execution: resolution.execution };
  return resolution.resolved
    ? {
        intent,
        resolved: true,
        sameElementProof: resolution.sameElementProof,
        ...locators,
      }
    : { intent, resolved: false, reason: resolution.reason, ...locators };
}

function classifyObservation(
  observation: StepObservation,
  step: PlanStep,
  diagnostics: Diagnostic[],
  decisions: string[],
): void {
  if (observation.locatorResolution && !observation.locatorResolution.resolved) {
    const reason = observation.locatorResolution.reason;
    if (step.required) {
      const code = locatorDiagnosticCode(reason);
      diagnostics.push(
        explorationDiagnostic(code, step.intent, `Locator resolution failed: ${reason}`),
      );
    } else {
      decisions.push(
        `Optional step observed-degraded: ${step.intent}: locator resolution ${reason}`,
      );
    }
  }
  if (observation.originDrifted) {
    diagnostics.push(
      explorationDiagnostic(
        ARXIC_EXPLORATION_ORIGIN_DRIFT,
        step.intent,
        `Exploration left the allowed origin at ${observation.url}`,
      ),
    );
  }
  if (
    !observation.ok &&
    (!observation.locatorResolution || observation.locatorResolution.resolved)
  ) {
    if (step.required) {
      diagnostics.push(
        explorationDiagnostic(
          ARXIC_EXPLORATION_STEP_FAILED,
          step.intent,
          observation.error ?? 'Browser exploration step failed',
        ),
      );
    } else {
      decisions.push(
        `Optional step observed-degraded: ${step.intent}: ${observation.error ?? 'browser step failed'}`,
      );
    }
  }
}

function locatorDiagnosticCode(
  reason: Extract<NonNullable<StepObservation['locatorResolution']>, { resolved: false }>['reason'],
): ExplorationDiagnosticCode {
  switch (reason) {
    case 'semantic-ambiguous':
    case 'execution-ambiguous':
      return ARXIC_EXPLORATION_LOCATOR_AMBIGUOUS;
    case 'semantic-inaccessible':
    case 'execution-inaccessible':
    case 'semantic-invalid':
    case 'execution-invalid':
      return ARXIC_EXPLORATION_LOCATOR_INACCESSIBLE;
    case 'mismatch':
      return ARXIC_EXPLORATION_LOCATOR_MISMATCH;
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

function successfullyObserved(step: PlanStep, evidenceRefs: readonly EvidenceRef[]): boolean {
  if (!step.url) return false;
  return evidenceRefs.some((evidence) => evidence.kind === 'runtime' && evidence.url === step.url);
}

function formatDiagnostic(diagnostic: Diagnostic): string {
  return `${diagnostic.code} [${diagnostic.severity}] ${diagnostic.subject}: ${diagnostic.message}`;
}
