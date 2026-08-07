import type { Workflow, WorkflowTransition } from '@arxic/contracts';
import type {
  AuthCandidate,
  AuthCapabilityId,
  AuthSurface,
  CapabilityBlocker,
  FixtureBlocker,
} from './types';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

const INBOX_FIXTURE: FixtureBlocker = {
  fixture: 'inbox',
  reason: 'Mailpit SMTP sink required for reset email delivery and token extraction.',
};

const TOTP_FIXTURE: FixtureBlocker = {
  fixture: 'totp',
  reason: 'A current TOTP must be generated from the newly enrolled secret at runtime.',
};

/**
 * Derive auth workflow candidates from the observed surface of a target app. The
 * transition states (which the compiler maps to routes) and success assertions come
 * from `surface` — per-app evidence supplied as data — not from hardcoded
 * reference-app routes. Candidates are `hypothesized` at most (ADR §2); only the
 * stage-10 verifier may originate `verified`. A capability the app structurally lacks
 * surfaces as an explicit `blocked` candidate (never silently dropped, never a
 * `contradicted` that hides a missing capability).
 */
export function authCandidates(surface: AuthSurface, commit = COMMIT): AuthCandidate[] {
  return [
    loginCandidate(surface, commit),
    logoutCandidate(surface, commit),
    resetRequestCandidate(surface, commit),
    resetCompleteCandidate(surface, commit),
    passwordChangeCandidate(surface, commit),
    totpCandidate(surface, commit),
  ];
}

function loginCandidate(surface: AuthSurface, commit: string): AuthCandidate {
  const id: AuthCapabilityId = 'authentication.login';
  const { entryState, successState, assertion } = surface.login;
  const transitions = [loginTransition(entryState, successState, assertion, id)];
  return { workflow: buildWorkflow(id, 'Login', transitions, commit, id) };
}

function logoutCandidate(surface: AuthSurface, commit: string): AuthCandidate {
  const id: AuthCapabilityId = 'authentication.logout';
  const { entryState, successState, assertion } = surface.login;
  const transitions = [
    loginTransition(entryState, successState, assertion, id),
    step(successState, successState, 'Click Logout', surface.logout.assertion, undefined, id),
  ];
  return { workflow: buildWorkflow(id, 'Logout', transitions, commit, id) };
}

// reset-request / reset-complete / TOTP are gated behind an inbox/totp fixture that this
// pack does not provision, so they never reach the compiler today. They carry only the
// shared sign-in precondition rather than a full per-app flow: the reset/TOTP step
// structure is genuinely per-app (e.g. a forgot-password *page* reached via a link vs a
// forgot form inlined on `/`), and hardcoding the reference-app flow here would reintroduce
// the very reference-route over-fit this slice removes. The capability-specific flow should
// be derived from the surface when its fixture is provisioned. Because the assembler blocks
// on `fixtureBlocker` before compiling, these placeholders cannot reach `verified`.
function resetRequestCandidate(surface: AuthSurface, commit: string): AuthCandidate {
  const id: AuthCapabilityId = 'authentication.reset-request';
  const { entryState, successState, assertion } = surface.login;
  const transitions = [loginTransition(entryState, successState, assertion, id)];
  return {
    workflow: buildWorkflow(id, 'Request a password reset', transitions, commit, id),
    fixtureBlocker: INBOX_FIXTURE,
  };
}

function resetCompleteCandidate(surface: AuthSurface, commit: string): AuthCandidate {
  const id: AuthCapabilityId = 'authentication.reset-complete';
  const { entryState, successState, assertion } = surface.login;
  const transitions = [loginTransition(entryState, successState, assertion, id)];
  return {
    workflow: buildWorkflow(id, 'Complete a password reset', transitions, commit, id),
    fixtureBlocker: INBOX_FIXTURE,
  };
}

function passwordChangeCandidate(surface: AuthSurface, commit: string): AuthCandidate {
  const id: AuthCapabilityId = 'authentication.password-change';
  if (!surface.passwordChange.supported) {
    return unsupportedCandidate(
      id,
      'Change password',
      surface,
      commit,
      surface.passwordChange.reason,
    );
  }
  const { entryState, successState, assertion } = surface.login;
  const { state, assertion: changeAssertion, routeAssertion } = surface.passwordChange;
  const transitions = [
    loginTransition(entryState, successState, assertion, id),
    step(successState, state, 'Open Change password', routeAssertion, undefined, id),
    step(
      state,
      state,
      'Submit password change',
      changeAssertion,
      {
        currentPassword: 'persona.password',
        newPassword: 'persona.newPassword',
      },
      id,
    ),
  ];
  return { workflow: buildWorkflow(id, 'Change password', transitions, commit, id) };
}

function totpCandidate(surface: AuthSurface, commit: string): AuthCandidate {
  const id: AuthCapabilityId = 'authentication.totp';
  if (!surface.totp.supported) {
    return unsupportedCandidate(id, 'Enroll TOTP', surface, commit, surface.totp.reason);
  }
  const { entryState, successState, assertion } = surface.login;
  const transitions = [loginTransition(entryState, successState, assertion, id)];
  return {
    workflow: buildWorkflow(id, 'Enroll TOTP', transitions, commit, id),
    fixtureBlocker: TOTP_FIXTURE,
  };
}

function unsupportedCandidate(
  id: AuthCapabilityId,
  title: string,
  surface: AuthSurface,
  commit: string,
  reason: string,
): AuthCandidate {
  const { entryState, successState, assertion } = surface.login;
  const transitions = [loginTransition(entryState, successState, assertion)];
  const capabilityBlocker: CapabilityBlocker = { reason };
  return {
    workflow: buildWorkflow(id, title, transitions, commit),
    capabilityBlocker,
  };
}

function loginTransition(
  entryState: string,
  successState: string,
  assertion: string,
  evidenceId?: AuthCapabilityId,
): WorkflowTransition {
  return step(
    entryState,
    successState,
    'Submit login credentials',
    assertion,
    {
      email: 'persona.email',
      password: 'persona.password',
    },
    evidenceId,
  );
}

function buildWorkflow(
  id: AuthCapabilityId,
  title: string,
  transitions: WorkflowTransition[],
  commit: string,
  evidenceId?: AuthCapabilityId,
): Workflow {
  const evidenceRefs = evidenceId ? [`src:${evidenceId}`, `run:${evidenceId}`] : [];
  return {
    $schema: 'https://arxic.dev/schemas/workflow/v1.json',
    id,
    version: 1,
    title,
    domain: 'authentication',
    persona: 'registered-user',
    status: 'hypothesized',
    confidence: 0.5,
    scope: { commit, environment: 'local-test', browser: 'chromium' },
    preconditions: [{ fixture: 'user.exists' }],
    states: [...new Set(transitions.flatMap(({ from, to }) => [from, to]))].map((stateId) => ({
      id: stateId,
    })),
    transitions,
    negativeCases: [],
    verification: {
      requiredRuns: 2,
      screenshotCheckpoints: [...new Set(transitions.map(({ to }) => to))],
      forbidNetworkErrors: true,
      trace: 'retain',
    },
    evidenceRefs,
  };
}

function step(
  from: string,
  to: string,
  intent: string,
  assertion: string,
  inputRefs?: Record<string, string>,
  evidenceId?: AuthCapabilityId,
): WorkflowTransition {
  const evidenceRefs = evidenceId ? [`src:${evidenceId}`, `run:${evidenceId}`] : [];
  return {
    from,
    to,
    action: { intent, ...(inputRefs ? { inputRefs } : {}) },
    assertions: [{ intent: assertion }],
    evidenceRefs,
  };
}
