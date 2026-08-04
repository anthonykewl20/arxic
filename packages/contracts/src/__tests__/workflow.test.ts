import { describe, expect, it } from 'vitest';
import {
  ARXIC_WORKFLOW_EVIDENCE_ID_INVALID,
  ARXIC_WORKFLOW_INVALID,
  ARXIC_WORKFLOW_NEGATIVE_NO_EXPECTED,
  ARXIC_WORKFLOW_STATUS_UNKNOWN,
  ARXIC_WORKFLOW_TRANSITION_NO_ASSERTIONS,
  ARXIC_WORKFLOW_VERIFICATION_MISSING,
  ARXIC_WORKFLOW_VERIFIED_WITHOUT_RUNTIME_EVIDENCE,
  validateWorkflow,
  type Workflow,
} from '..';

const workflow: Workflow = {
  $schema: 'https://arxic.dev/schemas/workflow/v1.json',
  id: 'auth.password-reset.request',
  version: 1,
  title: 'Request a password reset',
  domain: 'authentication',
  persona: 'registered-user',
  status: 'verified',
  confidence: 1.0,
  scope: {
    commit: '0123456789abcdef0123456789abcdef01234567',
    environment: 'local-test',
    browser: 'chromium',
    featureFlags: ['password-reset=true'],
  },
  preconditions: [
    { fixture: 'user.exists', parameters: { emailRef: 'persona.email' } },
    { fixture: 'mailbox.empty', parameters: { inboxRef: 'persona.inbox' } },
  ],
  states: [
    { id: 'login-page' },
    { id: 'reset-request-form' },
    { id: 'reset-request-accepted' },
    { id: 'reset-email-received' },
  ],
  transitions: [
    {
      from: 'login-page',
      to: 'reset-request-form',
      action: { intent: 'Open the forgot-password form' },
      assertions: [{ intent: 'Reset request form is available' }],
      evidenceRefs: ['src:forgot-link', 'run:forgot-link'],
    },
    {
      from: 'reset-request-form',
      to: 'reset-request-accepted',
      action: {
        intent: 'Submit the registered email',
        inputRefs: { email: 'persona.email' },
      },
      assertions: [{ intent: 'A non-enumerating acceptance message is shown' }],
      evidenceRefs: ['src:reset-handler', 'run:reset-submit'],
    },
    {
      from: 'reset-request-accepted',
      to: 'reset-email-received',
      action: { intent: 'Read the test inbox through InboxAdapter' },
      assertions: [{ intent: 'Exactly one valid reset message arrives' }],
      evidenceRefs: ['src:mailer', 'run:inbox-message'],
    },
  ],
  negativeCases: [
    { id: 'unknown-email', expected: 'The response does not disclose account existence' },
  ],
  verification: {
    requiredRuns: 2,
    screenshotCheckpoints: ['reset-request-form', 'reset-request-accepted'],
    trace: 'retain',
    forbidNetworkErrors: true,
  },
  evidenceRefs: [
    'src:forgot-link',
    'src:reset-handler',
    'src:mailer',
    'run:forgot-link',
    'run:reset-submit',
    'run:inbox-message',
  ],
};

const cloneWorkflow = (): Workflow => structuredClone(workflow);

const expectCode = (input: unknown, code: string) => {
  const result = validateWorkflow(input);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
  }
};

describe('Workflow contract', () => {
  it('rejects a transition with no assertions using a stable diagnostic', () => {
    const input = cloneWorkflow();
    input.transitions[0]!.assertions = [];
    expectCode(input, ARXIC_WORKFLOW_TRANSITION_NO_ASSERTIONS);
  });

  it('rejects verified when a required transition has source-only evidence because runtime evidence is required for verification', () => {
    const input = cloneWorkflow();
    input.transitions[0]!.evidenceRefs = ['src:x'];
    expectCode(input, ARXIC_WORKFLOW_VERIFIED_WITHOUT_RUNTIME_EVIDENCE);
  });

  it('accepts verified when an optional transition has source-only evidence', () => {
    const input = cloneWorkflow();
    input.transitions[0]!.required = false;
    input.transitions[0]!.evidenceRefs = ['src:x'];
    expect(validateWorkflow(input)).toEqual({ ok: true, value: input });
  });

  it('accepts hypothesized with a transition having source-only evidence', () => {
    const input = cloneWorkflow();
    input.status = 'hypothesized';
    input.transitions[0]!.evidenceRefs = ['src:x'];
    expect(validateWorkflow(input)).toEqual({ ok: true, value: input });
  });

  it('rejects verified source-only evidence when required is absent because transitions are required by default', () => {
    const input = cloneWorkflow();
    input.transitions[0]!.evidenceRefs = ['src:x'];
    expect(input.transitions[0]!.required).toBeUndefined();
    expectCode(input, ARXIC_WORKFLOW_VERIFIED_WITHOUT_RUNTIME_EVIDENCE);
  });

  it('rejects an unknown status using a stable diagnostic', () => {
    expectCode({ ...cloneWorkflow(), status: 'superseded' }, ARXIC_WORKFLOW_STATUS_UNKNOWN);
  });

  it('rejects a negative case without expected using a stable diagnostic', () => {
    const input = cloneWorkflow() as unknown as Record<string, unknown>;
    const negativeCases = input.negativeCases as Array<Record<string, unknown>>;
    delete negativeCases[0]!.expected;
    expectCode(input, ARXIC_WORKFLOW_NEGATIVE_NO_EXPECTED);
  });

  it('rejects verification missing requiredRuns using a stable diagnostic', () => {
    const input = cloneWorkflow() as unknown as Record<string, unknown>;
    delete (input.verification as Record<string, unknown>).requiredRuns;
    expectCode(input, ARXIC_WORKFLOW_VERIFICATION_MISSING);
  });

  it('rejects an invalid evidence id using a stable diagnostic', () => {
    const input = cloneWorkflow();
    input.evidenceRefs[0] = ':bogus';
    expectCode(input, ARXIC_WORKFLOW_EVIDENCE_ID_INVALID);
  });

  it.each(['transitions', 'states', 'verification', 'scope'])(
    'rejects a missing top-level %s field using a stable diagnostic',
    (field) => {
      const input = cloneWorkflow() as unknown as Record<string, unknown>;
      delete input[field];
      expectCode(input, ARXIC_WORKFLOW_INVALID);
    },
  );

  it('accepts confidence for a non-verified status because confidence is descriptive-only', () => {
    const input = cloneWorkflow();
    input.status = 'observed';
    input.confidence = 0.75;
    expect(validateWorkflow(input)).toEqual({ ok: true, value: input });
  });

  it('rejects a deliberately wrong ADR-shaped workflow missing a transition action', () => {
    const input = cloneWorkflow() as unknown as Record<string, unknown>;
    const transitions = input.transitions as Array<Record<string, unknown>>;
    delete transitions[0]!.action;
    expectCode(input, ARXIC_WORKFLOW_INVALID);
  });

  it('accepts the ADR §10.3 password-reset literal', () => {
    expect(validateWorkflow(workflow)).toEqual({ ok: true, value: workflow });
  });
});
