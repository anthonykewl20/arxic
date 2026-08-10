import { createHash } from 'node:crypto';
import type {
  ExplorationDriver,
  ExplorationDriverResult,
  PlannedExplorationStep,
} from '@arxic/playwright-agent-adapter';
import { describe, expect, it } from 'vitest';
import {
  ARXIC_EXPLORATION_APPROVAL_DENIED,
  ARXIC_EXPLORATION_BUDGET_EXHAUSTED,
  ARXIC_EXPLORATION_FORBIDDEN,
  ARXIC_EXPLORATION_LOCATOR_AMBIGUOUS,
  ARXIC_EXPLORATION_LOCATOR_INACCESSIBLE,
  ARXIC_EXPLORATION_LOCATOR_MISMATCH,
  ARXIC_EXPLORATION_ORIGIN_DRIFT,
  ARXIC_EXPLORATION_STEP_FAILED,
  ARXIC_EXPLORATION_TRANSITIONS_UNOBSERVED,
  EXPLORATION_DIAGNOSTIC_CODES,
  explorationDiagnostic,
  planExploration,
  runPlannedExploration,
  type ExplorationPlan,
} from '../exploration';
import type { Candidate } from '../types';

describe('stage-8 intent exploration', () => {
  it('loop-closes every exploration diagnostic through the frozen contract', () => {
    for (const code of EXPLORATION_DIAGNOSTIC_CODES) {
      expect(explorationDiagnostic(code, 'stage-8', 'contract proof')).toEqual(
        expect.objectContaining({ code, subject: 'stage-8' }),
      );
    }
  });

  it('plans deterministic read-only observation before login form submission', () => {
    const first = planExploration([candidate('submit login form at /login')], origin);
    expect(first).toEqual(planExploration([candidate('submit login form at /login')], origin));
    expect(first.steps[0]).toEqual(
      expect.objectContaining({
        action: 'navigation',
        actionClass: 'read-only',
        url: `${origin}/login`,
      }),
    );
    expect(first.steps).toContainEqual(
      expect.objectContaining({ action: 'form-submit', actionClass: 'reversible-mutation' }),
    );
  });

  it('blocks an unknown policy action without executing it', async () => {
    const driver = new FakeDriver([]);
    const result = await run(driver, plan({ action: 'unknown', actionClass: 'read-only' }));
    expect(result.approved).toBe(false);
    expect(result.decisions).toContainEqual(expect.stringContaining(ARXIC_EXPLORATION_FORBIDDEN));
    expect(result.decisions).toContainEqual(expect.stringContaining('[blocked]'));
    expect(driver.executed).toEqual([]);
  });

  it('blocks a destructive action without recorded human approval', async () => {
    const result = await run(
      new FakeDriver([]),
      plan({ action: 'delete-user', actionClass: 'destructive' }),
    );
    expect(result.approved).toBe(false);
    expect(result.decisions).toContainEqual(
      expect.stringContaining(ARXIC_EXPLORATION_APPROVAL_DENIED),
    );
  });

  it('blocks gracefully when budget is exhausted mid-plan', async () => {
    const driver = new FakeDriver([observation(`${origin}/one`)]);
    const result = await run(
      driver,
      {
        steps: [navigation('one', '/one'), navigation('two', '/two')],
      },
      1,
    );
    expect(result.approved).toBe(false);
    expect(result.decisions).toContainEqual(
      expect.stringContaining(ARXIC_EXPLORATION_BUDGET_EXHAUSTED),
    );
    expect(driver.executed).toHaveLength(1);
  });

  it('blocks a read-only plan when its budget is missing at zero', async () => {
    const result = await run(new FakeDriver([]), { steps: [navigation('login', '/login')] }, 0);
    expect(result.approved).toBe(false);
    expect(result.decisions).toContainEqual(
      expect.stringContaining(ARXIC_EXPLORATION_BUDGET_EXHAUSTED),
    );
  });

  it('blocks origin drift instead of silently accepting the observation', async () => {
    const result = await run(
      new FakeDriver([{ ...observation('https://outside.example/login'), originDrifted: true }]),
      { steps: [navigation('login', '/login')] },
    );
    expect(result.approved).toBe(false);
    expect(result.decisions).toContainEqual(
      expect.stringContaining(ARXIC_EXPLORATION_ORIGIN_DRIFT),
    );
  });

  it('reports required unobserved transitions only as observed and never verified', async () => {
    const result = await run(
      new FakeDriver([]),
      {
        steps: [
          { intent: 'delete', action: 'delete-user', actionClass: 'destructive', required: true },
        ],
      },
      1,
      {
        approver: 'human@example.test',
        approvedAt: '2026-08-07T00:00:00.000Z',
        reason: 'approved fixture-only proof',
      },
    );
    expect(result.approved).toBe(true);
    expect(result.decisions).toContainEqual(
      expect.stringContaining(`${ARXIC_EXPLORATION_TRANSITIONS_UNOBSERVED} [observed]`),
    );
    expect(result.decisions.join('\n')).not.toContain('[verified]');
  });

  it('blocks a failed required browser step', async () => {
    const result = await run(
      new FakeDriver([
        {
          intent: 'login',
          url: `${origin}/login`,
          ok: false,
          originDrifted: false,
          error: 'locator drift',
        },
      ]),
      { steps: [navigation('login', '/login')] },
    );
    expect(result.approved).toBe(false);
    expect(result.decisions).toContainEqual(expect.stringContaining(ARXIC_EXPLORATION_STEP_FAILED));
  });

  it.each([
    ['semantic-ambiguous', ARXIC_EXPLORATION_LOCATOR_AMBIGUOUS],
    ['execution-ambiguous', ARXIC_EXPLORATION_LOCATOR_AMBIGUOUS],
    ['semantic-inaccessible', ARXIC_EXPLORATION_LOCATOR_INACCESSIBLE],
    ['execution-inaccessible', ARXIC_EXPLORATION_LOCATOR_INACCESSIBLE],
    ['semantic-invalid', ARXIC_EXPLORATION_LOCATOR_INACCESSIBLE],
    ['execution-invalid', ARXIC_EXPLORATION_LOCATOR_INACCESSIBLE],
    ['mismatch', ARXIC_EXPLORATION_LOCATOR_MISMATCH],
  ] as const)('classifies locator resolution %s as blocked %s', async (reason, code) => {
    const locator = {
      semantic: { kind: 'label', text: 'Email' },
      execution: { kind: 'role', role: 'textbox', name: 'Email' },
    } as const;
    const result = await run(
      new FakeDriver([
        {
          intent: 'login',
          url: `${origin}/login`,
          ok: false,
          originDrifted: false,
          locatorResolution: { resolved: false, reason, ...locator },
        },
      ]),
      { steps: [navigation('login', '/login')] },
    );

    expect(result.approved).toBe(false);
    expect(result.decisions).toContainEqual(expect.stringContaining(`${code} [blocked] login:`));
    expect(result.decisions.join('\n')).not.toContain('textbox');
  });

  it('keeps an unresolved optional locator observed-degraded instead of blocked-approved', async () => {
    const result = await run(
      new FakeDriver([
        {
          intent: 'optional login control',
          url: `${origin}/login`,
          ok: false,
          originDrifted: false,
          locatorResolution: {
            resolved: false,
            reason: 'semantic-invalid',
            semantic: { kind: 'role', role: 'button >> nth=0' },
            execution: { kind: 'role', role: 'button' },
          },
        },
      ]),
      { steps: [{ ...navigation('optional login control', '/login'), required: false }] },
    );

    expect(result.approved).toBe(true);
    expect(result.decisions).toContainEqual(
      expect.stringContaining('Optional step observed-degraded: optional login control'),
    );
    expect(result.decisions.join('\n')).not.toContain('[blocked]');
  });

  it('classifies a multiline fill failure without persisting its secret', async () => {
    const secret = 'line1\nSECRET-line2';
    const result = await run(
      new FakeDriver([
        {
          intent: 'fill rejected control',
          url: `${origin}/login`,
          ok: false,
          originDrifted: false,
          locatorResolution: {
            resolved: true,
            semantic: { kind: 'role', role: 'checkbox' },
            execution: { kind: 'role', role: 'checkbox' },
          },
          error: 'browser action failed',
        },
      ]),
      { steps: [navigation('fill rejected control', '/login')] },
    );

    expect(result.decisions).toContainEqual(expect.stringContaining(ARXIC_EXPLORATION_STEP_FAILED));
    expect(result.decisions.join('\n')).not.toContain(secret);
    expect(result.decisions.join('\n')).not.toContain('SECRET-line2');
  });

  it('classifies an action failure after successful locator resolution as a failed step', async () => {
    const result = await run(
      new FakeDriver([
        {
          intent: 'login',
          url: `${origin}/login`,
          ok: false,
          originDrifted: false,
          locatorResolution: {
            resolved: true,
            semantic: { kind: 'label', text: 'Email' },
            execution: { kind: 'role', role: 'textbox', name: 'Email' },
          },
          error: 'Browser action failed',
        },
      ]),
      { steps: [navigation('login', '/login')] },
    );

    expect(result.decisions).toContainEqual(expect.stringContaining(ARXIC_EXPLORATION_STEP_FAILED));
  });

  it('emits runtime accessibility evidence for successful read-only exploration', async () => {
    const sha256 = createHash('sha256').update('{"name":"Login","role":"WebArea"}').digest('hex');
    const result = await run(
      new FakeDriver([{ ...observation(`${origin}/login`), accessibilitySnapshotSha256: sha256 }]),
      { steps: [navigation('login', '/login')] },
    );
    expect(result.approved).toBe(true);
    expect(result.evidenceRefs).toContainEqual(
      expect.objectContaining({ kind: 'runtime', accessibilitySnapshotSha256: sha256 }),
    );
  });
});

const origin = 'http://127.0.0.1:4321';

class FakeDriver implements ExplorationDriver {
  readonly #observations: ExplorationDriverResult['observations'];
  executed: readonly PlannedExplorationStep[] = [];

  constructor(observations: ExplorationDriverResult['observations']) {
    this.#observations = observations;
  }

  async execute(steps: readonly PlannedExplorationStep[]): Promise<ExplorationDriverResult> {
    this.executed = steps;
    return { observations: this.#observations, browserVersion: 'fake-browser' };
  }

  async close(): Promise<void> {}
}

function navigation(intent: string, path: string) {
  return {
    intent,
    action: 'navigation',
    actionClass: 'read-only',
    url: `${origin}${path}`,
    required: true,
  } as const;
}

function plan(step: { action: string; actionClass: 'read-only' | 'destructive' }): ExplorationPlan {
  return { steps: [{ intent: step.action, ...step, url: `${origin}/login`, required: true }] };
}

function observation(url: string) {
  return {
    intent: 'login',
    url,
    ok: true,
    originDrifted: false,
    browserVersion: '123.0.0.0',
    accessibilitySnapshot: { role: 'WebArea', name: 'Login' },
    accessibilitySnapshotSha256: 'a'.repeat(64),
  } as const;
}

async function run(
  driver: ExplorationDriver,
  explorationPlan: ExplorationPlan,
  budget = 8,
  approval?: { approver: string; approvedAt: string; reason: string },
) {
  return runPlannedExploration({
    runId: 'unit-exploration',
    origin,
    candidates: [],
    budget,
    driver,
    plan: explorationPlan,
    ...(approval ? { approval } : {}),
    now: () => '2026-08-07T00:00:00.000Z',
  });
}

function candidate(intent: string): Candidate {
  return {
    id: 'authentication.login',
    title: 'Login',
    evidenceRefs: ['src:login'],
    workflow: {
      $schema: 'https://arxic.dev/schemas/workflow/v1.json',
      id: 'authentication.login',
      version: 1,
      title: 'Login',
      domain: 'authentication',
      persona: 'registered-user',
      status: 'hypothesized',
      confidence: 0.5,
      scope: { commit: 'a'.repeat(40), environment: 'local-test', browser: 'chromium' },
      preconditions: [],
      states: [{ id: 'signed-out' }, { id: 'signed-in' }],
      transitions: [
        {
          from: 'signed-out',
          to: 'signed-in',
          action: { intent },
          assertions: [{ intent: 'authenticated state is visible' }],
          evidenceRefs: ['src:login'],
        },
      ],
      negativeCases: [],
      verification: {
        requiredRuns: 2,
        screenshotCheckpoints: ['signed-in'],
        forbidNetworkErrors: true,
        trace: 'retain',
      },
      evidenceRefs: ['src:login'],
    },
  };
}
