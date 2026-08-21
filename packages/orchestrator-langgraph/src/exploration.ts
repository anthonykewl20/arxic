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
import type {
  Candidate,
  ExplorationResult,
  FixtureLeaseState,
  LocatorProvenanceRecord,
} from './types';

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
  /** Fixture requirement authorizing a reversible action, if the plan can identify one. */
  fixtureKind?: string;
  required: boolean;
}> &
  PlanStepExecution &
  Readonly<{ formScope?: Readonly<{ fieldLabel: string; submitName: string }> }>;

export type ExplorationPlan = Readonly<{ steps: readonly PlanStep[] }>;

export type ExplorationInput = Readonly<{
  runId: string;
  origin: string;
  /**
   * DG-289 C-4 (#289, DECISION issuecomment-5360240026): config-declared
   * `target.allowedOrigins` — admitted into the exploration PolicyEngine
   * origin list alongside the target origin. Fail-closed default when
   * unset/empty: target origin only.
   */
  allowedOrigins?: readonly string[];
  appBuildDigest?: string;
  candidates: readonly Candidate[];
  approval?: ApprovalInput;
  budget: number;
  sandboxAdapterPresent?: boolean;
  leases?: readonly FixtureLeaseState[];
  /** @deprecated Supply the stage-7 lease collection through `leases`. */
  lease?: FixtureLeaseState;
  driver?: ExplorationDriver;
  browser?: string;
  now?: () => string;
}>;

/**
 * DG-289 C-4 (#289, DECISION issuecomment-5360240026): the origin list the
 * exploration PolicyEngine is constructed with — the target origin plus
 * config-declared `allowedOrigins`. Fail-closed default when unset/empty:
 * the target origin only (byte-identical to the pre-wiring baseline).
 */
export function explorationAllowedOrigins(
  input: Readonly<Pick<ExplorationInput, 'origin' | 'allowedOrigins'>>,
): string[] {
  return input.allowedOrigins && input.allowedOrigins.length > 0
    ? [...new Set([input.origin, ...input.allowedOrigins])]
    : [input.origin];
}

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
      const fixtureKinds = [
        ...new Set(candidate.workflow.preconditions.map(({ fixture }) => fixture)),
      ];
      steps.push({
        intent: transition.action.intent,
        action: mapped.action,
        actionClass: mapped.actionClass,
        ...(mapped.url ? { url: mapped.url } : {}),
        ...(mapped.actionClass === 'reversible-mutation' && fixtureKinds.length === 1
          ? { fixtureKind: fixtureKinds[0] }
          : {}),
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
    allowedOrigins: explorationAllowedOrigins(input),
    sandboxAdapterPresent: input.sandboxAdapterPresent ?? false,
    now: () => Date.parse((input.now ?? (() => new Date().toISOString()))()),
  });
  const approvals = approvalsFor(plan, input.approval, input.origin);
  const diagnostics: Diagnostic[] = [];
  const decisions: string[] = [];
  const evidenceRefs: EvidenceRef[] = [];
  const locatorProvenance: LocatorProvenanceRecord[] = [];
  const executable: PlanStep[] = [];
  const observations: StepObservation[] = [];
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
    const leaseSelection = selectLease(input, step.fixtureKind);
    const lease = leaseSelection.lease;
    if (
      step.actionClass === 'reversible-mutation' &&
      (leaseSelection.invalid || leaseSelection.collision)
    ) {
      const message = 'Fixture lease owner or expiry does not authorize this run';
      diagnostics.push(explorationDiagnostic(ARXIC_EXPLORATION_FORBIDDEN, step.intent, message));
      decisions.push(message);
      approved = false;
      safeToExecute = false;
      break;
    }
    if (step.actionClass === 'reversible-mutation' && !lease) {
      decisions.push(
        `Step authorized but not executed (actionClass ${step.actionClass} requires fixtures/approval-handled): ${step.intent}`,
      );
      continue;
    }
    const decision = engine.decide({
      action: step.action,
      actionClass: step.actionClass,
      origin: input.origin,
      ...(lease ? { lease } : {}),
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
        observations.push(observation);
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
  // DG-08: expose the post-action observation for the compile stage. The
  // observation anchor is the FINAL successful CLICK step — the form-drive
  // plan's submit — so the observation genuinely describes the post-action
  // state (ADR-008 Decision 7); navigate-only runs expose nothing and the
  // compile stage blocks OBSERVATION-MISSING instead of guessing.
  const postAction = postActionOf(executable, observations, (pruned) => {
    // Fail-visible (DG-08 final review P2): ambiguous headings are dropped,
    // never asserted loosely — the omission is RECORDED so the run record
    // shows why a text assertion is absent while the url assertion still
    // binds. Bounded by design: ambiguity never blocks the observation.
    decisions.push(
      `Omitted ${String(pruned)} ambiguous post-action heading${pruned === 1 ? '' : 's'} from the observation (name collision on the page would compile to a strict-mode-violating text assertion); the url assertion still binds`,
    );
  });
  return {
    approved,
    evidenceRefs,
    decisions,
    ...(locatorProvenance.length > 0 ? { locatorProvenance: { records: locatorProvenance } } : {}),
    ...(postAction ? { postAction } : {}),
  };
}

const MAX_POST_ACTION_HEADINGS = 3;

function postActionOf(
  executable: readonly PlanStep[],
  observations: readonly StepObservation[],
  onAmbiguousHeadingsPruned?: (count: number) => void,
): { url: string; headings: readonly string[] } | undefined {
  // The observation describes the post-action state ONLY when the ENTIRE
  // drive succeeded: any failed or drifted step means the final page is not
  // the intended outcome (e.g. a submit clicked with empty fields).
  for (const [index, step] of executable.entries()) {
    const observation = observations[index];
    if (!step || !observation) continue;
    if (!observation.ok || observation.originDrifted) return undefined;
  }
  for (let index = executable.length - 1; index >= 0; index -= 1) {
    const step = executable[index];
    const observation = observations[index];
    if (!step || !observation) continue;
    if (step.kind !== 'click') continue;
    if (!observation.accessibilitySnapshot) continue;
    const all = headingNames(observation.accessibilitySnapshot);
    const unambiguous = unambiguousHeadingNames(observation.accessibilitySnapshot);
    if (all.length > unambiguous.length)
      onAmbiguousHeadingsPruned?.(all.length - unambiguous.length);
    const headings = unambiguous.slice(0, MAX_POST_ACTION_HEADINGS);
    return { url: observation.url, headings };
  }
  return undefined;
}

function headingNames(node: import('@arxic/playwright-agent-adapter').AccessibilityNode): string[] {
  const names: string[] = [];
  if (node.role === 'heading' && node.name) names.push(node.name);
  for (const child of node.children ?? []) names.push(...headingNames(child));
  return names;
}

/**
 * Headings whose accessible name is UNIQUE among all accessible names on the
 * page. An ambiguous heading (e.g. an h2 "Login" next to a "Login" button)
 * would compile to a strict-mode-violating getByText assertion — it is
 * dropped (honest omission), never asserted loosely.
 */
function unambiguousHeadingNames(
  node: import('@arxic/playwright-agent-adapter').AccessibilityNode,
): string[] {
  const nameCounts = new Map<string, number>();
  const countNames = (current: typeof node): void => {
    if (current.name) nameCounts.set(current.name, (nameCounts.get(current.name) ?? 0) + 1);
    for (const child of current.children ?? []) countNames(child);
  };
  countNames(node);
  return headingNames(node).filter((name) => (nameCounts.get(name) ?? 0) === 1);
}

function selectLease(
  input: ExplorationInput,
  fixtureKind: string | undefined,
): Readonly<{ lease?: LeaseState; invalid: boolean; collision: boolean }> {
  const supplied = [...(input.lease ? [input.lease] : []), ...(input.leases ?? [])];
  const matching = supplied.filter((candidate) => candidate.requirement?.kind === fixtureKind);
  if (matching.length === 0) return { invalid: false, collision: false };
  const candidates = matching.filter((candidate) => !candidate.inUse);
  if (candidates.length === 0) return { invalid: false, collision: true };
  const now = Date.parse((input.now ?? (() => new Date().toISOString()))());
  const lease = candidates.find(
    (candidate) => candidate.owner === input.runId && Date.parse(candidate.expiresAt) > now,
  );
  return lease ? { lease, invalid: false, collision: false } : { invalid: true, collision: false };
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
  if (/submit|form/i.test(intent))
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
        ...(step.formScope ? { formScope: step.formScope } : {}),
      };
    case 'click':
      return {
        intent: step.intent,
        kind: 'click',
        locator: step.locator,
        ...(step.url ? { url: step.url } : {}),
        ...(step.formScope ? { formScope: step.formScope } : {}),
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
    // DG-08: `fill` is a DOM-local, policy-registered read-only action —
    // the page-local half of a leased form submit.
    return (
      step.kind === 'snapshot' ||
      step.kind === 'navigate' ||
      step.kind === 'fill' ||
      Boolean(step.url)
    );
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
