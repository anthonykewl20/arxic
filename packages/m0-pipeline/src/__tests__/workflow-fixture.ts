import type { Workflow } from '@arxic/contracts';

export function loginWorkflow(commit = '0123456789abcdef0123456789abcdef01234567'): Workflow {
  return {
    $schema: 'https://arxic.dev/schemas/workflow/v1.json',
    id: 'authentication.login',
    version: 1,
    title: 'Login',
    domain: 'authentication',
    persona: 'registered-user',
    status: 'observed',
    confidence: 1,
    scope: { commit, environment: 'local-test', browser: 'chromium' },
    preconditions: [{ fixture: 'user.exists' }],
    states: [{ id: 'login-page' }, { id: 'home' }],
    transitions: [
      {
        from: 'login-page',
        to: 'home',
        action: {
          intent: 'Submit login credentials',
          inputRefs: { email: 'persona.email', password: 'persona.password' },
        },
        assertions: [{ intent: 'url:/' }],
        evidenceRefs: ['src:login-handler'],
      },
    ],
    negativeCases: [],
    verification: {
      requiredRuns: 2,
      screenshotCheckpoints: ['home'],
      forbidNetworkErrors: true,
      trace: 'retain',
    },
    evidenceRefs: ['src:login-handler'],
  };
}
