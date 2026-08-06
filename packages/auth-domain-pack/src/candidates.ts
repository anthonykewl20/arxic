import type { Workflow, WorkflowTransition } from '@arxic/contracts';
import type { AuthCandidate } from './types';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

export function authCandidates(commit = COMMIT): AuthCandidate[] {
  return [
    candidate(
      'authentication.login',
      'Login',
      [
        transition('login-page', 'home', 'Submit login credentials', 'url:/', {
          email: 'persona.email',
          password: 'persona.password',
        }),
      ],
      commit,
    ),
    candidate(
      'authentication.logout',
      'Logout',
      [
        transition('login-page', 'home', 'Submit login credentials', 'url:/', {
          email: 'persona.email',
          password: 'persona.password',
        }),
        transition('home', 'home', 'Click Logout', 'text:Logged out'),
      ],
      commit,
    ),
    candidate(
      'authentication.reset-request',
      'Request a password reset',
      [
        transition('login-page', 'home', 'Submit login credentials', 'url:/', {
          email: 'persona.email',
          password: 'persona.password',
        }),
        transition('home', 'forgot-password-page', 'Open Forgot password', 'url:/forgot-password'),
        transition(
          'forgot-password-page',
          'reset-request-accepted',
          'Submit registered email',
          'text:If that account exists, a reset email has been sent.',
          { email: 'persona.email' },
        ),
      ],
      commit,
      {
        fixture: 'inbox',
        reason: 'Mailpit SMTP sink required for reset email delivery.',
      },
    ),
    candidate(
      'authentication.reset-complete',
      'Complete a password reset',
      [
        transition(
          'reset-password-page',
          'login-page',
          'Submit new password',
          'text:Password reset successfully',
          { password: 'persona.newPassword' },
        ),
      ],
      commit,
      {
        fixture: 'inbox',
        reason: 'A reset token must be read from the isolated inbox and added to the reset URL.',
      },
    ),
    candidate(
      'authentication.password-change',
      'Change password',
      [
        transition('login-page', 'home', 'Submit login credentials', 'url:/', {
          email: 'persona.email',
          password: 'persona.password',
        }),
        transition('home', 'change-password-page', 'Open Change password', 'url:/change-password'),
        transition(
          'change-password-page',
          'change-password-page',
          'Submit password change',
          'text:Password changed successfully',
          { currentPassword: 'persona.password', newPassword: 'persona.newPassword' },
        ),
      ],
      commit,
    ),
    candidate(
      'authentication.totp',
      'Enroll TOTP',
      [
        transition('login-page', 'home', 'Submit login credentials', 'url:/', {
          email: 'persona.email',
          password: 'persona.password',
        }),
        transition('home', 'mfa/enroll-page', 'Open Enroll MFA', 'url:/mfa/enroll'),
        transition(
          'mfa/enroll-page',
          'mfa/enroll-page',
          'Click Generate secret',
          'text:MFA secret generated',
        ),
        transition(
          'mfa/enroll-page',
          'mfa/enroll-page',
          'Submit authentication code',
          'text:MFA enrollment confirmed',
          { token: 'persona.totp' },
        ),
      ],
      commit,
      {
        fixture: 'totp',
        reason: 'A current TOTP must be generated from the newly enrolled secret at runtime.',
      },
    ),
  ];
}

function candidate(
  id: string,
  title: string,
  transitions: WorkflowTransition[],
  commit: string,
  fixtureBlocker?: AuthCandidate['fixtureBlocker'],
): AuthCandidate {
  const evidenceRefs = transitions.flatMap(({ evidenceRefs }) => evidenceRefs);
  const workflow: Workflow = {
    $schema: 'https://arxic.dev/schemas/workflow/v1.json',
    id,
    version: 1,
    title,
    domain: 'authentication',
    persona: 'registered-user',
    status: 'observed',
    confidence: 1,
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
  return {
    workflow,
    ...(fixtureBlocker ? { fixtureBlocker } : {}),
  };
}

function transition(
  from: string,
  to: string,
  intent: string,
  assertion: string,
  inputRefs?: Record<string, string>,
): WorkflowTransition {
  const slug = `${from}-${to}-${intent}`
    .replaceAll('/', '-')
    .replace(/[^A-Za-z0-9.-]+/gu, '-')
    .toLowerCase();
  return {
    from,
    to,
    action: { intent, ...(inputRefs ? { inputRefs } : {}) },
    assertions: [{ intent: assertion }],
    evidenceRefs: [`src:${slug}`, `run:${slug}`],
  };
}
