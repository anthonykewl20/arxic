import { createHash } from 'node:crypto';
import type { Workflow } from '@arxic/contracts';
import type {
  AccessibilityNode,
  ExplorationDriver,
  ExplorationDriverResult,
  LocatorPair,
  PlannedExplorationStep,
  StepObservation,
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
import type { Candidate, FixtureLeaseState } from '../types';

describe('DG-08 post-action observation binding invariants (final review P2 pins)', () => {
  const submitStep = (required = true) => ({
    intent: 'submit newsletter form via "Subscribe"',
    action: 'form-submit',
    actionClass: 'reversible-mutation' as const,
    kind: 'click' as const,
    locator: {
      semantic: { kind: 'role' as const, role: 'button', name: 'Subscribe' },
      execution: { kind: 'role' as const, role: 'button', name: 'Subscribe' },
    },
    fixtureKind: 'persona',
    required,
  });

  const personaLease = (runId: string) => ({
    id: `${runId}-lease`,
    owner: runId,
    expiresAt: '2099-01-01T00:00:00.000Z',
    inUse: false,
    requirement: { kind: 'persona' },
  });

  const snapshotObservation = (
    url: string,
    snapshot: AccessibilityNode,
    ok = true,
    originDrifted = false,
  ): StepObservation => ({
    intent: 'snapshot',
    url,
    ok,
    originDrifted,
    accessibilitySnapshot: snapshot,
    accessibilitySnapshotSha256: 'f'.repeat(64),
    browserVersion: '1.62.1',
  });

  it('an UNAPPROVED form drive exposes NO post-action observation (nothing to bind)', async () => {
    // The submit is denied: no persona lease authorizes the reversible
    // mutation, so the step is policy-skipped, the driver executes nothing,
    // and the result carries NO postAction — compile then honestly blocks
    // OBSERVATION-MISSING instead of binding an unapproved post-state.
    const driver = new FakeDriver([
      snapshotObservation(`${origin}/subscribed`, { role: 'WebArea', name: 'Subscribed' }),
    ]);
    const result = await runPlannedExploration({
      runId: 'p2-unapproved-drive',
      origin,
      candidates: [],
      budget: 4,
      driver,
      plan: { steps: [submitStep()] },
    });
    expect(result.approved).toBe(true); // read-only-only runs stay approved
    expect(driver.executed).toEqual([]); // the mutation never ran
    expect(result.postAction).toBeUndefined();
    expect(result.decisions).toContainEqual(expect.stringContaining('requires fixtures'));
  });

  const failedObservation = (intent: string): StepObservation => ({
    intent,
    url: `${origin}/newsletter`,
    ok: false,
    originDrifted: false,
    locatorResolution: {
      resolved: false,
      reason: 'semantic-ambiguous',
      semantic: { kind: 'label', text: 'Email' },
      execution: { kind: 'label', text: 'Email' },
    },
    browserVersion: '1.62.1',
  });

  it('a drive whose FINAL step fails binds NO post-action observation even though earlier steps passed', async () => {
    // Navigate + fill succeed; the submit click FAILS (locator resolution).
    // The final page is a failed-drive state, not the proposal outcome — no
    // partial post-action binding is permitted.
    const driver = new FakeDriver([
      snapshotObservation(`${origin}/newsletter`, {
        role: 'WebArea',
        name: 'Newsletter',
        children: [{ role: 'textbox', name: 'Email' }],
      }),
      failedObservation('fill Email'),
      {
        // The failed submit STILL leaves a page state behind (the error
        // page). Without the all-steps-ok invariant this snapshot would be
        // bound as the proposal's post-action observation.
        ...failedObservation('submit newsletter form via "Subscribe"'),
        accessibilitySnapshot: {
          role: 'WebArea',
          name: 'Error page',
          children: [{ role: 'heading', name: 'Something went wrong' }],
        },
        accessibilitySnapshotSha256: 'a'.repeat(64),
      },
    ]);
    const result = await runPlannedExploration({
      runId: 'p2-failed-final-step',
      origin,
      candidates: [],
      budget: 8,
      driver,
      leases: [personaLease('p2-failed-final-step')],
      plan: {
        steps: [
          { ...navigation('observe route /newsletter', '/newsletter'), kind: 'navigate' as const },
          {
            intent: 'fill Email',
            action: 'fill',
            actionClass: 'read-only' as const,
            kind: 'fill' as const,
            required: true,
            locator: {
              semantic: { kind: 'label' as const, text: 'Email' },
              execution: { kind: 'label' as const, text: 'Email' },
            },
            value: 'persona@example.test',
          },
          submitStep(),
        ],
      },
    });
    expect(result.approved).toBe(false);
    expect(result.postAction).toBeUndefined();
    // The decisions record carries the blocked locator diagnostics.
    expect(result.decisions).toContainEqual(
      expect.stringContaining(ARXIC_EXPLORATION_LOCATOR_AMBIGUOUS),
    );
  });

  it('a drive where an EARLIER step fails but the final click SUCCEEDS binds NO post-action observation', async () => {
    // Navigate succeeds; the FILL fails (ambiguous locator); the submit click
    // then lands on a clean Dashboard page. A weakened guard inspecting only
    // the FINAL observation would bind that page — the every-step invariant
    // must refuse: a mid-plan failure means the drive is not the outcome.
    const driver = new FakeDriver([
      snapshotObservation(`${origin}/newsletter`, {
        role: 'WebArea',
        name: 'Newsletter',
        children: [{ role: 'textbox', name: 'Email' }],
      }),
      failedObservation('fill Email'),
      snapshotObservation(`${origin}/dashboard`, {
        role: 'WebArea',
        name: 'Dashboard page',
        children: [{ role: 'heading', name: 'Dashboard' }],
      }),
    ]);
    const result = await runPlannedExploration({
      runId: 'p2-failed-earlier-step',
      origin,
      candidates: [],
      budget: 8,
      driver,
      leases: [personaLease('p2-failed-earlier-step')],
      plan: {
        steps: [
          { ...navigation('observe route /newsletter', '/newsletter'), kind: 'navigate' as const },
          {
            intent: 'fill Email',
            action: 'fill',
            actionClass: 'read-only' as const,
            kind: 'fill' as const,
            required: true,
            locator: {
              semantic: { kind: 'label' as const, text: 'Email' },
              execution: { kind: 'label' as const, text: 'Email' },
            },
            value: 'persona@example.test',
          },
          submitStep(),
        ],
      },
    });
    expect(result.approved).toBe(false);
    expect(result.postAction).toBeUndefined();
    expect(result.decisions).toContainEqual(
      expect.stringContaining(ARXIC_EXPLORATION_LOCATOR_AMBIGUOUS),
    );
  });

  it('an origin-drifted observation binds NOTHING even when it is the only click result', async () => {
    const driver = new FakeDriver([
      {
        intent: 'submit newsletter form via "Subscribe"',
        url: 'http://evil.example.test/subscribed',
        ok: true,
        originDrifted: true,
        accessibilitySnapshot: { role: 'WebArea', name: 'Attacker' },
        accessibilitySnapshotSha256: 'e'.repeat(64),
        browserVersion: '1.62.1',
      },
    ]);
    const result = await runPlannedExploration({
      runId: 'p2-drifted-click',
      origin,
      candidates: [],
      budget: 4,
      driver,
      leases: [personaLease('p2-drifted-click')],
      plan: { steps: [submitStep()] },
    });
    expect(result.postAction).toBeUndefined();
    expect(result.decisions).toContainEqual(
      expect.stringContaining(ARXIC_EXPLORATION_ORIGIN_DRIFT),
    );
  });

  it('a drive where an EARLY observation drifted origin but the final click SUCCEEDS binds NO post-action observation', async () => {
    // The navigate observation drifted off-origin (a page rendered, but
    // elsewhere); the submit click itself succeeds on a clean page. Mid-plan
    // drift poisons the drive exactly like a failed step — nothing may bind.
    const driver = new FakeDriver([
      snapshotObservation(
        'http://evil.example.test/newsletter',
        { role: 'WebArea', name: 'Attacker' },
        true,
        true,
      ),
      snapshotObservation(`${origin}/subscribed`, {
        role: 'WebArea',
        name: 'Subscribed page',
        children: [{ role: 'heading', name: 'Subscribed' }],
      }),
    ]);
    const result = await runPlannedExploration({
      runId: 'p2-early-drift-final-ok',
      origin,
      candidates: [],
      budget: 4,
      driver,
      leases: [personaLease('p2-early-drift-final-ok')],
      plan: {
        steps: [
          { ...navigation('observe route /newsletter', '/newsletter'), kind: 'navigate' as const },
          submitStep(),
        ],
      },
    });
    expect(result.approved).toBe(false);
    expect(result.postAction).toBeUndefined();
    expect(result.decisions).toContainEqual(
      expect.stringContaining(ARXIC_EXPLORATION_ORIGIN_DRIFT),
    );
  });

  it('ambiguous post-action headings are DROPPED but the omission is RECORDED and the url assertion still binds', async () => {
    // The page has TWO accessible nodes named "Login" (an h2 heading and the
    // button) plus a UNIQUE h1 "Dashboard": the ambiguous heading is pruned
    // (fail-visible decision), the unique one binds, and the observation
    // (whose url becomes the url-floor assertion) still exists.
    const driver = new FakeDriver([
      snapshotObservation(`${origin}/dashboard`, {
        role: 'WebArea',
        name: 'Dashboard page',
        children: [
          { role: 'heading', name: 'Dashboard' },
          { role: 'heading', name: 'Login' },
          { role: 'button', name: 'Login' },
        ],
      }),
    ]);
    const result = await runPlannedExploration({
      runId: 'p2-ambiguous-headings',
      origin,
      candidates: [],
      budget: 4,
      driver,
      leases: [personaLease('p2-ambiguous-headings')],
      plan: { steps: [submitStep()] },
    });
    expect(result.approved).toBe(true);
    expect(result.postAction).toBeDefined();
    expect(result.postAction?.url).toBe(`${origin}/dashboard`);
    expect(result.postAction?.headings).toEqual(['Dashboard']);
    // Fail-visible: the pruned ambiguous heading is RECORDED as a decision.
    expect(result.decisions).toContainEqual(
      expect.stringContaining('Omitted 1 ambiguous post-action heading'),
    );
  });

  it('an unambiguous page records NO pruning decision', async () => {
    const driver = new FakeDriver([
      snapshotObservation(`${origin}/thanks`, {
        role: 'WebArea',
        name: 'Thanks page',
        children: [{ role: 'heading', name: 'Subscribed' }],
      }),
    ]);
    const result = await runPlannedExploration({
      runId: 'p2-clean-headings',
      origin,
      candidates: [],
      budget: 4,
      driver,
      leases: [personaLease('p2-clean-headings')],
      plan: { steps: [submitStep()] },
    });
    expect(result.postAction?.headings).toEqual(['Subscribed']);
    expect(
      result.decisions.some((decision) => decision.includes('ambiguous post-action heading')),
    ).toBe(false);
  });
});

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

  it('executes a reversible action with a supplied lease and skips the same action without one', async () => {
    const step = {
      intent: 'submit login',
      action: 'form-submit',
      actionClass: 'reversible-mutation' as const,
      kind: 'click' as const,
      fixtureKind: 'persona',
      locator: {
        semantic: { kind: 'role' as const, role: 'button', name: 'Login' },
        execution: { kind: 'role' as const, role: 'button', name: 'Login' },
      },
      required: true,
    };
    const withLeaseDriver = new FakeDriver([observation(`${origin}/`)]);
    const withLease = await runPlannedExploration({
      runId: 'reversible-with-lease',
      origin,
      candidates: [],
      budget: 1,
      driver: withLeaseDriver,
      leases: [
        {
          id: 'reversible-lease',
          owner: 'reversible-with-lease',
          expiresAt: '2099-01-01T00:00:00.000Z',
          inUse: false,
          requirement: { kind: 'persona' },
        },
      ],
      plan: { steps: [step] },
    });
    const withoutLeaseDriver = new FakeDriver([]);
    const withoutLease = await runPlannedExploration({
      runId: 'reversible-without-lease',
      origin,
      candidates: [],
      budget: 1,
      driver: withoutLeaseDriver,
      plan: { steps: [step] },
    });

    expect(withLease.approved).toBe(true);
    expect(withLeaseDriver.executed).toHaveLength(1);
    expect(withoutLeaseDriver.executed).toEqual([]);
    expect(withoutLease.decisions).toContainEqual(expect.stringContaining('requires fixtures'));
  });

  it('authorizes reversible steps only with a lease for that step fixture requirement', async () => {
    const driver = new FakeDriver([observation(`${origin}/persona`), observation(`${origin}/otp`)]);
    const result = await runPlannedExploration({
      runId: 'per-requirement-leases',
      origin,
      candidates: [],
      budget: 3,
      driver,
      leases: [
        {
          id: 'persona-lease',
          owner: 'per-requirement-leases',
          expiresAt: '2099-01-01T00:00:00.000Z',
          inUse: false,
          requirement: { kind: 'persona' },
        },
        {
          id: 'otp-lease',
          owner: 'per-requirement-leases',
          expiresAt: '2099-01-01T00:00:00.000Z',
          inUse: false,
          requirement: { kind: 'otp' },
        },
      ] as never,
      plan: {
        steps: [
          reversibleStep('persona step', 'persona'),
          reversibleStep('otp step', 'otp'),
          reversibleStep('unleased inbox step', 'inbox'),
        ],
      } as unknown as ExplorationPlan,
    });

    expect(driver.executed.map((step) => step.intent)).toEqual(['persona step', 'otp step']);
    expect(result.decisions).toContainEqual(expect.stringContaining('unleased inbox step'));
  });

  it('derives one fixture kind for a reversible candidate and executes it only with that lease kind', async () => {
    const plan = planExploration(
      [candidate('submit login form', [{ fixture: 'persona' }])],
      origin,
    );
    const derived = plan.steps.find((step) => step.actionClass === 'reversible-mutation');
    if (!derived) throw new Error('Expected a reversible derived step');
    expect(derived.fixtureKind).toBe('persona');
    const driver = new FakeDriver([observation(`${origin}/`)]);

    await runPlannedExploration({
      runId: 'derived-persona',
      origin,
      candidates: [],
      budget: 1,
      driver,
      leases: [
        {
          id: 'derived-persona-lease',
          owner: 'derived-persona',
          expiresAt: '2099-01-01T00:00:00.000Z',
          inUse: false,
          requirement: { kind: 'persona' },
        },
      ],
      plan: {
        steps: [
          {
            ...derived,
            kind: 'click',
            locator: {
              semantic: { kind: 'role', role: 'button', name: 'Login' },
              execution: { kind: 'role', role: 'button', name: 'Login' },
            },
          },
        ],
      },
    });

    expect(driver.executed).toHaveLength(1);
  });

  it('silently skips the deprecated single-lease input when it has no matching requirement kind', async () => {
    const plan = planExploration(
      [candidate('submit login form', [{ fixture: 'persona' }])],
      origin,
    );
    const derived = plan.steps.find((step) => step.actionClass === 'reversible-mutation');
    if (!derived) throw new Error('Expected a reversible derived step');
    const driver = new FakeDriver([]);
    const result = await runPlannedExploration({
      runId: 'deprecated-single-lease',
      origin,
      candidates: [],
      budget: 1,
      driver,
      lease: {
        id: 'deprecated-lease',
        owner: 'deprecated-single-lease',
        expiresAt: '2099-01-01T00:00:00.000Z',
        inUse: false,
      } as never,
      plan: {
        steps: [
          {
            ...derived,
            kind: 'click',
            locator: {
              semantic: { kind: 'role', role: 'button', name: 'Login' },
              execution: { kind: 'role', role: 'button', name: 'Login' },
            },
          },
        ],
      },
    });

    expect(driver.executed).toEqual([]);
    expect(result.decisions).toContainEqual(expect.stringContaining('requires fixtures'));
  });

  it('leaves multi-kind reversible candidates untyped and fail-closed skipped', async () => {
    const plan = planExploration(
      [candidate('submit login form', [{ fixture: 'persona' }, { fixture: 'inbox' }])],
      origin,
    );
    const derived = plan.steps.find((step) => step.actionClass === 'reversible-mutation');
    if (!derived) throw new Error('Expected a reversible derived step');
    expect(derived.fixtureKind).toBeUndefined();
    const driver = new FakeDriver([]);

    await runPlannedExploration({
      runId: 'derived-multi-kind',
      origin,
      candidates: [],
      budget: 1,
      driver,
      leases: [
        {
          id: 'derived-persona-lease',
          owner: 'derived-multi-kind',
          expiresAt: '2099-01-01T00:00:00.000Z',
          inUse: false,
          requirement: { kind: 'persona' },
        },
      ],
      plan: {
        steps: [
          {
            ...derived,
            kind: 'click',
            locator: {
              semantic: { kind: 'role', role: 'button', name: 'Login' },
              execution: { kind: 'role', role: 'button', name: 'Login' },
            },
          },
        ],
      },
    });

    expect(driver.executed).toEqual([]);
  });

  it.each([
    [
      'foreign owner',
      {
        id: 'foreign-lease',
        owner: 'another-run',
        expiresAt: '2099-01-01T00:00:00.000Z',
        inUse: false,
        requirement: { kind: 'persona' },
      },
    ],
    [
      'expired lease',
      {
        id: 'expired-lease',
        owner: 'reversible-invalid-lease',
        expiresAt: '2030-01-01T00:00:00.000Z',
        inUse: false,
        requirement: { kind: 'persona' },
      },
    ],
  ] as const)('rejects a reversible action with a %s', async (_name, lease) => {
    const driver = new FakeDriver([]);
    const result = await runPlannedExploration({
      runId: 'reversible-invalid-lease',
      origin,
      candidates: [],
      budget: 1,
      driver,
      leases: [lease],
      plan: {
        steps: [
          {
            intent: 'submit login',
            action: 'form-submit',
            actionClass: 'reversible-mutation',
            kind: 'click',
            fixtureKind: 'persona',
            locator: {
              semantic: { kind: 'role', role: 'button', name: 'Login' },
              execution: { kind: 'role', role: 'button', name: 'Login' },
            },
            required: true,
          },
        ],
      },
      now: () => '2031-01-01T00:00:00.000Z',
    });

    expect(result.approved).toBe(false);
    expect(driver.executed).toEqual([]);
    expect(result.decisions).toContainEqual(expect.stringContaining(ARXIC_EXPLORATION_FORBIDDEN));
  });

  it('reports a collision when every supplied fixture lease is in use instead of treating it as absent', async () => {
    const driver = new FakeDriver([]);
    const result = await runPlannedExploration({
      runId: 'reversible-in-use',
      origin,
      candidates: [],
      budget: 1,
      driver,
      leases: [
        {
          id: 'busy',
          owner: 'reversible-in-use',
          expiresAt: '2099-01-01T00:00:00.000Z',
          inUse: true,
          requirement: { kind: 'persona' },
        },
        {
          id: 'also-busy',
          owner: 'reversible-in-use',
          expiresAt: '2099-01-01T00:00:00.000Z',
          inUse: true,
          requirement: { kind: 'persona' },
        },
      ],
      plan: {
        steps: [
          {
            intent: 'submit login',
            action: 'form-submit',
            actionClass: 'reversible-mutation',
            kind: 'click',
            fixtureKind: 'persona',
            locator: {
              semantic: { kind: 'role', role: 'button', name: 'Login' },
              execution: { kind: 'role', role: 'button', name: 'Login' },
            },
            required: true,
          },
        ],
      },
    });
    expect(result.approved).toBe(false);
    expect(driver.executed).toEqual([]);
    expect(result.decisions).toContainEqual(expect.stringContaining(ARXIC_EXPLORATION_FORBIDDEN));
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

  // #306 (F-E5): binding is derived at OBSERVATION TIME, not re-derived by
  // URL string equality — the exact directus-dg12-run5/run14 field shape:
  // every step observed, every step also falsely TRANSITIONS-UNOBSERVED.
  it('counts an observed url-less fill/submit step as observed (#306)', async () => {
    const result = await run(
      new FakeDriver([
        observation(`${origin}/login`),
        observation(`${origin}/login`),
        observation(`${origin}/login`),
      ]),
      {
        steps: [
          navigation('login', '/login'),
          {
            intent: 'fill Email',
            action: 'fill',
            actionClass: 'read-only',
            required: true,
            kind: 'fill',
            locator: {
              semantic: { kind: 'label', text: 'Email' },
              execution: { kind: 'label', text: 'Email' },
            },
            value: 'persona@example.test',
          },
          {
            intent: 'submit via Sign In',
            action: 'form-submit',
            actionClass: 'reversible-mutation',
            required: true,
            kind: 'click',
            fixtureKind: 'persona',
            locator: {
              semantic: { kind: 'role', role: 'button', name: 'Sign In' },
              execution: { kind: 'role', role: 'button', name: 'Sign In' },
            },
          },
        ],
      },
      3,
      undefined,
      [
        {
          id: 'fill-submit-lease',
          owner: 'unit-exploration',
          expiresAt: '2099-01-01T00:00:00.000Z',
          inUse: false,
          requirement: { kind: 'persona' },
        },
      ],
    );
    expect(result.approved).toBe(true);
    expect(result.decisions.join('\n')).not.toContain(ARXIC_EXPLORATION_TRANSITIONS_UNOBSERVED);
  }, 15_000);

  it('matches a navigate step modulo a trailing slash, but not a different path (#306)', async () => {
    const slashMatch = await run(
      new FakeDriver([observation(`${origin}/admin/`)]),
      { steps: [navigation('observe route /admin', '/admin')] },
      1,
    );
    expect(slashMatch.decisions.join('\n')).not.toContain(ARXIC_EXPLORATION_TRANSITIONS_UNOBSERVED);

    const differentPath = await run(
      new FakeDriver([observation(`${origin}/admin/login`)]),
      { steps: [navigation('observe route /admin', '/admin')] },
      1,
    );
    expect(differentPath.decisions.join('\n')).toContain(ARXIC_EXPLORATION_TRANSITIONS_UNOBSERVED);
  }, 15_000);

  it('still reports a required step whose observation failed as unobserved (#306 AC-5)', async () => {
    const result = await run(
      new FakeDriver([{ ...observation(`${origin}/login`), ok: false, error: 'boom' }]),
      { steps: [{ ...navigation('login', '/login') }] },
      1,
    );
    expect(result.approved).toBe(false);
    expect(result.decisions.join('\n')).toContain(ARXIC_EXPLORATION_TRANSITIONS_UNOBSERVED);
  }, 15_000);

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

  it('persists failed fill and click locator provenance with their executable intents', async () => {
    const email: LocatorPair = {
      semantic: { kind: 'label', text: 'Email', exact: true },
      execution: { kind: 'role', role: 'textbox', name: 'Email', exact: true },
    };
    const submit: LocatorPair = {
      semantic: { kind: 'role', role: 'button', name: 'Login', exact: true },
      execution: { kind: 'role', role: 'button', name: 'Login', exact: true },
    };
    const driver = new FakeDriver([
      {
        intent: 'driver fill observation',
        url: `${origin}/login`,
        ok: false,
        originDrifted: false,
        locatorResolution: { resolved: false, reason: 'mismatch', ...email },
      },
      {
        intent: 'driver click observation',
        url: `${origin}/login`,
        ok: false,
        originDrifted: false,
        locatorResolution: {
          resolved: false,
          reason: 'semantic-ambiguous',
          ...submit,
        },
      },
    ]);

    const result = await runPlannedExploration({
      runId: 'unit-locator-provenance-failure',
      origin,
      candidates: [],
      budget: 2,
      driver,
      lease: {
        id: 'locator-provenance-lease',
        owner: 'unit-locator-provenance-failure',
        expiresAt: '2099-01-01T00:00:00.000Z',
        inUse: false,
        requirement: { kind: 'persona' },
      },
      plan: {
        steps: [
          {
            intent: 'fill login email',
            action: 'fixture-change',
            actionClass: 'reversible-mutation',
            kind: 'fill',
            fixtureKind: 'persona',
            locator: email,
            value: 'must-not-be-persisted@example.test',
            url: `${origin}/login`,
            required: true,
          },
          {
            intent: 'click login submit',
            action: 'form-submit',
            actionClass: 'reversible-mutation',
            kind: 'click',
            fixtureKind: 'persona',
            locator: submit,
            required: true,
          },
        ],
      },
      now: () => '2026-08-12T00:00:00.000Z',
    });

    expect(driver.executed.map(({ intent, kind }) => ({ intent, kind }))).toEqual([
      { intent: 'fill login email', kind: 'fill' },
      { intent: 'click login submit', kind: 'click' },
    ]);
    expect(result.locatorProvenance?.records).toEqual([
      {
        intent: 'fill login email',
        resolved: false,
        reason: 'mismatch',
        ...email,
      },
      {
        intent: 'click login submit',
        resolved: false,
        reason: 'semantic-ambiguous',
        ...submit,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('must-not-be-persisted@example.test');
  });

  it('persists successful fill and click locator provenance with same-element proof', async () => {
    const email: LocatorPair = {
      semantic: { kind: 'label', text: 'Email', exact: true },
      execution: { kind: 'role', role: 'textbox', name: 'Email', exact: true },
    };
    const submit: LocatorPair = {
      semantic: { kind: 'role', role: 'button', name: 'Login', exact: true },
      execution: { kind: 'role', role: 'button', name: 'Login', exact: true },
    };
    const driver = new FakeDriver([
      {
        intent: 'driver fill observation',
        url: `${origin}/login`,
        ok: true,
        originDrifted: false,
        locatorResolution: { resolved: true, sameElementProof: true, ...email },
      },
      {
        intent: 'driver click observation',
        url: `${origin}/`,
        ok: true,
        originDrifted: false,
        locatorResolution: { resolved: true, sameElementProof: true, ...submit },
      },
    ]);

    const result = await runPlannedExploration({
      runId: 'unit-locator-provenance-success',
      origin,
      candidates: [],
      budget: 2,
      driver,
      lease: {
        id: 'locator-provenance-lease',
        owner: 'unit-locator-provenance-success',
        expiresAt: '2099-01-01T00:00:00.000Z',
        inUse: false,
        requirement: { kind: 'persona' },
      },
      plan: {
        steps: [
          {
            intent: 'fill login email',
            action: 'fixture-change',
            actionClass: 'reversible-mutation',
            kind: 'fill',
            fixtureKind: 'persona',
            locator: email,
            value: 'unit@example.test',
            url: `${origin}/login`,
            required: true,
          },
          {
            intent: 'click login submit',
            action: 'form-submit',
            actionClass: 'reversible-mutation',
            kind: 'click',
            fixtureKind: 'persona',
            locator: submit,
            required: true,
          },
        ],
      },
      now: () => '2026-08-12T00:00:00.000Z',
    });

    expect(result.locatorProvenance?.records).toEqual([
      {
        intent: 'fill login email',
        resolved: true,
        sameElementProof: true,
        ...email,
      },
      {
        intent: 'click login submit',
        resolved: true,
        sameElementProof: true,
        ...submit,
      },
    ]);
    expect(JSON.stringify(result.locatorProvenance?.records)).not.toContain('executionHandle');
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
    // The Action inherits the Service's safe-error guarantee and only proves classification here.
    const result = await run(
      new FakeDriver([
        {
          intent: 'fill rejected control',
          url: `${origin}/login`,
          ok: false,
          originDrifted: false,
          locatorResolution: {
            resolved: true,
            sameElementProof: true,
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
            sameElementProof: true,
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

function reversibleStep(intent: string, fixtureKind: string) {
  return {
    intent,
    action: 'form-submit',
    actionClass: 'reversible-mutation' as const,
    kind: 'click' as const,
    locator: {
      semantic: { kind: 'role' as const, role: 'button', name: intent },
      execution: { kind: 'role' as const, role: 'button', name: intent },
    },
    required: false,
    fixtureKind,
  };
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
  leases?: readonly FixtureLeaseState[],
) {
  return runPlannedExploration({
    runId: 'unit-exploration',
    origin,
    candidates: [],
    budget,
    driver,
    plan: explorationPlan,
    ...(approval ? { approval } : {}),
    ...(leases ? { leases } : {}),
    now: () => '2026-08-07T00:00:00.000Z',
  });
}

function candidate(intent: string, preconditions: Workflow['preconditions'] = []): Candidate {
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
      preconditions,
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
