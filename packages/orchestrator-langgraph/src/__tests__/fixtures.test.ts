import type { FixtureLease, FixtureProvider, FixtureRequirement, Workflow } from '@arxic/contracts';
import { describe, expect, test } from 'vitest';
import {
  ARXIC_FIXTURE_INBOX_MISSING,
  ARXIC_FIXTURE_LEASE_LEAK,
  ARXIC_FIXTURE_MISSING,
  ARXIC_FIXTURE_RELEASE_FAILED,
  ARXIC_FIXTURE_RESET_FAILED,
  ARXIC_FIXTURE_SECRET_LEAK,
  ARXIC_FIXTURE_UNKNOWN_DB,
  FixtureCoordinator,
  fixtureDiagnostic,
} from '../fixture-coordinator';
import type { Candidate } from '../types';

describe('FixtureCoordinator sad paths', () => {
  test('marks a required unavailable adapter blocked and never fakes a lease', async () => {
    const result = await new FixtureCoordinator([]).prepare({
      candidates: [candidate([{ fixture: 'inbox' }])],
    });
    expect(result).toMatchObject({ provisioned: false, leases: [] });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_FIXTURE_MISSING, severity: 'blocked' }),
    );
  });

  test('detects, resets, and blocks an unreleased prior lease on the next run', async () => {
    const provider = new BoundaryProvider();
    const coordinator = new FixtureCoordinator([provider]);
    const first = await coordinator.prepare({ candidates: [candidate([{ fixture: 'persona' }])] });
    expect(first.provisioned).toBe(true);
    const second = await coordinator.prepare({ candidates: [] });
    expect(second.provisioned).toBe(false);
    expect(second.diagnostics[0]?.code).toBe(ARXIC_FIXTURE_LEASE_LEAK);
    expect(provider.resetIds).toEqual(['boundary:1']);
    expect(provider.releaseIds).toEqual(['boundary:1']);
  });

  test('carries the run owner and active lease fields needed by reversible-action policy', async () => {
    const provider = new BoundaryProvider();
    const coordinator = new FixtureCoordinator([provider]);
    const prepared = await coordinator.prepare({
      candidates: [candidate([{ fixture: 'persona' }])],
      runId: 'fixture-owner-run',
    });

    expect(prepared).toMatchObject({
      provisioned: true,
      leases: [
        {
          id: 'boundary:1',
          owner: 'fixture-owner-run',
          inUse: false,
          expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        },
      ],
    });

    await coordinator.release(prepared.leases);
    expect(provider.resetIds).toEqual(['boundary:1']);
    expect(provider.releaseIds).toEqual(['boundary:1']);
  });

  test('rehydrates with a fresh coordinator and re-resolves its provider for terminal release', async () => {
    const provider = new BoundaryProvider();
    const initial = await new FixtureCoordinator([provider]).prepare({
      candidates: [candidate([{ fixture: 'persona' }])],
      runId: 'rehydrated-run',
    });
    const fresh = new FixtureCoordinator([provider]);

    const rehydrated = fresh.rehydrate(initial.leases, new Date('2035-01-01T00:00:00.000Z'));
    expect(await fresh.release(rehydrated)).toEqual([]);
    expect(provider.resetIds).toEqual(['boundary:1']);
    expect(provider.releaseIds).toEqual(['boundary:1']);
  });

  test('reports release failure when a fresh coordinator cannot resolve a persisted lease provider', async () => {
    const initial = await new FixtureCoordinator([new BoundaryProvider()]).prepare({
      candidates: [candidate([{ fixture: 'persona' }])],
      runId: 'orphaned-run',
    });
    const fresh = new FixtureCoordinator([]);

    const rehydrated = fresh.rehydrate(initial.leases);
    expect(await fresh.release(rehydrated)).toContainEqual(
      expect.objectContaining({ code: ARXIC_FIXTURE_RELEASE_FAILED, severity: 'observed' }),
    );
  });

  test('reports reset and release failures independently while still attempting reset then release', async () => {
    const resetFails = new BoundaryProvider({ resetFails: true });
    const resetCoordinator = new FixtureCoordinator([resetFails]);
    const resetLease = await resetCoordinator.prepare({
      candidates: [candidate([{ fixture: 'persona' }])],
    });
    expect(await resetCoordinator.release(resetLease.leases)).toEqual([
      expect.objectContaining({ code: ARXIC_FIXTURE_RESET_FAILED, severity: 'observed' }),
    ]);
    expect(resetFails.releaseIds).toEqual(['boundary:1']);

    const releaseFails = new BoundaryProvider({ releaseFails: true });
    const releaseCoordinator = new FixtureCoordinator([releaseFails]);
    const releaseLease = await releaseCoordinator.prepare({
      candidates: [candidate([{ fixture: 'persona' }])],
    });
    expect(await releaseCoordinator.release(releaseLease.leases)).toEqual([
      expect.objectContaining({ code: ARXIC_FIXTURE_RELEASE_FAILED, severity: 'observed' }),
    ]);
    expect(releaseFails.resetIds).toEqual(['boundary:1']);
    expect(releaseFails.releaseIds).toEqual(['boundary:1']);
  });

  test('drops a terminal cleanup failure so the next run proceeds with a one-shot observed leak warning', async () => {
    const provider = new BoundaryProvider({ releaseFails: true });
    const coordinator = new FixtureCoordinator([provider]);
    const initial = await coordinator.prepare({
      candidates: [candidate([{ fixture: 'persona' }])],
      runId: 'terminal-cleanup-failure',
    });

    await expect(coordinator.release(initial.leases)).resolves.toContainEqual(
      expect.objectContaining({ code: ARXIC_FIXTURE_RELEASE_FAILED, severity: 'observed' }),
    );
    await expect(coordinator.prepare({ candidates: [], runId: 'next-run' })).resolves.toMatchObject(
      {
        provisioned: true,
        diagnostics: [
          expect.objectContaining({
            code: ARXIC_FIXTURE_LEASE_LEAK,
            severity: 'observed',
            subject: 'fixture-coordinator',
          }),
        ],
      },
    );
    await expect(coordinator.prepare({ candidates: [], runId: 'following-run' })).resolves.toEqual({
      requirements: [],
      leases: [],
      diagnostics: [],
      provisioned: true,
    });
  });

  test('drops an expired foreign lease from tracking without touching its provider', async () => {
    let now = new Date('2026-08-15T00:00:00.000Z');
    const provider = new BoundaryProvider();
    const coordinator = new FixtureCoordinator([provider], { now: () => now });
    await coordinator.prepare({
      candidates: [candidate([{ fixture: 'persona' }])],
      runId: 'hard-killed-run',
    });
    now = new Date('2026-08-15T00:06:00.000Z');

    await expect(
      coordinator.prepare({ candidates: [], runId: 'replacement-run' }),
    ).resolves.toMatchObject({
      provisioned: true,
      diagnostics: [
        expect.objectContaining({ code: ARXIC_FIXTURE_LEASE_LEAK, severity: 'observed' }),
      ],
    });
    expect(provider.resetIds).toEqual([]);
    expect(provider.releaseIds).toEqual([]);
    await expect(coordinator.prepare({ candidates: [], runId: 'following-run' })).resolves.toEqual({
      requirements: [],
      leases: [],
      diagnostics: [],
      provisioned: true,
    });
  });

  test('runs provider reaping only through explicit maintenance, never normal lifecycle', async () => {
    const provider = new ReapingProvider();
    const now = new Date('2026-08-15T00:00:00.000Z');
    const result = await new FixtureCoordinator([provider], { now: () => now }).prepare({
      candidates: [],
      runId: 'reaper-run',
    });

    expect(provider.reapCalls).toEqual([]);
    expect(result).toMatchObject({ provisioned: true });
    const leases = [
      {
        id: 'maintenance:1',
        owner: 'maintenance-run',
        expiresAt: '2026-08-15T00:00:00.000Z',
        inUse: false,
        requirement: { kind: 'inbox', parameters: { recipient: 'maintenance@example.test' } },
      },
    ] as const;
    await expect(
      new FixtureCoordinator([provider]).reapExpiredLeases(leases, now),
    ).resolves.toEqual([]);
    expect(provider.reapCalls).toEqual([{ leases, now }]);
  });

  test('does not retry a provider after a failed terminal cleanup lease was dropped', async () => {
    const provider = new BoundaryProvider({ releaseFails: true });
    const coordinator = new FixtureCoordinator([provider]);
    const prepared = await coordinator.prepare({
      candidates: [candidate([{ fixture: 'persona' }])],
      runId: 'dropped-release',
    });

    await coordinator.release(prepared.leases);
    await expect(coordinator.release(prepared.leases)).resolves.toContainEqual(
      expect.objectContaining({
        code: ARXIC_FIXTURE_RELEASE_FAILED,
        message: 'Fixture lease was not registered for release',
      }),
    );
    expect(provider.releaseIds).toEqual(['boundary:1']);
  });

  test('returns partial-provision cleanup failures in the blocked preparation result', async () => {
    const result = await new FixtureCoordinator([new PartialFailureProvider()]).prepare({
      candidates: [candidate([{ fixture: 'persona' }, { fixture: 'inbox' }])],
      runId: 'partial-cleanup-failure',
    });

    expect(result).toMatchObject({ provisioned: false });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_FIXTURE_RELEASE_FAILED, severity: 'observed' }),
    );
  });

  test('blocks and removes raw secret and PII when a provider leaks fixture values', async () => {
    const rawSecret = 'JBSWY3DPEHPK3PXP';
    const password = 'NeverPersistThis1!';
    const provider = new BoundaryProvider(true);
    const result = await new FixtureCoordinator([provider]).prepare({
      candidates: [
        candidate([
          {
            fixture: 'persona',
            parameters: { password, email: 'private@example.test', secret: rawSecret },
          },
        ]),
      ],
    });
    const serialized = JSON.stringify(result);
    expect(result.provisioned).toBe(false);
    expect(result.diagnostics[0]?.code).toBe(ARXIC_FIXTURE_SECRET_LEAK);
    expect(serialized).not.toContain(rawSecret);
    expect(serialized).not.toContain(password);
    expect(serialized).not.toContain('private@example.test');
  });

  test('recursively redacts every primitive requirement value and detects nested lease leaks', async () => {
    const parameters = {
      totpKey: 'RAWSECRET',
      config: { password: 'RAWPW', enabled: true },
      digits: 6,
      hints: ['PRIVATEHINT'],
    };
    const safe = await new FixtureCoordinator([new BoundaryProvider()]).prepare({
      candidates: [candidate([{ fixture: 'otp', parameters }])],
    });
    expect(safe.requirements[0]).toEqual({
      kind: 'otp',
      parameters: {
        totpKey: '[REDACTED]',
        config: { password: '[REDACTED]', enabled: '[REDACTED]' },
        digits: '[REDACTED]',
        hints: ['[REDACTED]'],
      },
    });
    expect(JSON.stringify(safe)).not.toContain('RAWSECRET');
    expect(JSON.stringify(safe)).not.toContain('RAWPW');
    const leaked = await new FixtureCoordinator([new BoundaryProvider(true)]).prepare({
      candidates: [candidate([{ fixture: 'otp', parameters }])],
    });
    expect(leaked.provisioned).toBe(false);
    expect(leaked.diagnostics[0]?.code).toBe(ARXIC_FIXTURE_SECRET_LEAK);
    expect(JSON.stringify(leaked)).not.toContain('RAWSECRET');
  });

  test('redacts sensitive values from provider diagnostics before persisting them', async () => {
    const password = 'RAW-DIAGNOSTIC-PASSWORD';
    const result = await new FixtureCoordinator([new DiagnosticProvider(password)]).prepare({
      candidates: [candidate([{ fixture: 'persona', parameters: { config: { password } } }])],
    });
    expect(result.provisioned).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: ARXIC_FIXTURE_UNKNOWN_DB,
      severity: 'blocked',
      message: 'Fixture provider returned a diagnostic containing a sensitive value; redacted',
      subject: 'Fixture provider returned a diagnostic containing a sensitive value; redacted',
    });
    expect(JSON.stringify(result)).not.toContain(password);
  });
});

test('every frozen fixture diagnostic code validates through the contract helper', () => {
  for (const code of [
    ARXIC_FIXTURE_MISSING,
    ARXIC_FIXTURE_LEASE_LEAK,
    ARXIC_FIXTURE_SECRET_LEAK,
    ARXIC_FIXTURE_INBOX_MISSING,
    ARXIC_FIXTURE_UNKNOWN_DB,
  ]) {
    expect(fixtureDiagnostic(code, 'fixture', 'Stable fixture diagnostic')).toMatchObject({
      code,
      severity: 'blocked',
    });
  }
});

class BoundaryProvider implements FixtureProvider {
  readonly resetIds: string[] = [];
  readonly releaseIds: string[] = [];
  readonly #leak: boolean;
  readonly #resetFails: boolean;
  readonly #releaseFails: boolean;

  constructor(
    options: boolean | Readonly<{ resetFails?: boolean; releaseFails?: boolean }> = false,
  ) {
    this.#leak = typeof options === 'boolean' && options;
    this.#resetFails = typeof options !== 'boolean' && (options.resetFails ?? false);
    this.#releaseFails = typeof options !== 'boolean' && (options.releaseFails ?? false);
  }

  supports(requirement: FixtureRequirement): boolean {
    return requirement.kind === 'persona' || requirement.kind === 'otp';
  }

  async provision(requirement: FixtureRequirement): Promise<FixtureLease> {
    return {
      id: 'boundary:1',
      requirement: this.#leak ? requirement : { kind: requirement.kind },
    };
  }

  async reset(lease: FixtureLease): Promise<void> {
    this.resetIds.push(lease.id);
    if (this.#resetFails) throw new Error('reset failed');
  }

  async release(lease: FixtureLease): Promise<void> {
    this.releaseIds.push(lease.id);
    if (this.#releaseFails) throw new Error('release failed');
  }
}

class DiagnosticProvider implements FixtureProvider {
  readonly #password: string;

  constructor(password: string) {
    this.#password = password;
  }

  supports(requirement: FixtureRequirement): boolean {
    return requirement.kind === 'persona';
  }

  async provision(): Promise<FixtureLease> {
    throw new DiagnosticBoundaryError(
      fixtureDiagnostic(
        ARXIC_FIXTURE_UNKNOWN_DB,
        `persona ${this.#password}`,
        `Provider exposed ${this.#password}`,
      ),
    );
  }

  async reset(): Promise<void> {}

  async release(): Promise<void> {}
}

class PartialFailureProvider implements FixtureProvider {
  async provision(requirement: FixtureRequirement): Promise<FixtureLease> {
    if (requirement.kind === 'inbox') throw new Error('inbox provisioning failed');
    return { id: 'partial:persona', requirement };
  }

  supports(requirement: FixtureRequirement): boolean {
    return requirement.kind === 'persona' || requirement.kind === 'inbox';
  }

  async reset(): Promise<void> {}

  async release(): Promise<void> {
    throw new Error('release failed');
  }
}

class ReapingProvider implements FixtureProvider {
  readonly reapCalls: Array<Readonly<{ leases: readonly FixtureLease[]; now: Date }>> = [];

  supports(): boolean {
    return true;
  }

  async provision(): Promise<FixtureLease> {
    throw new Error('not supported');
  }

  async reset(): Promise<void> {}

  async release(): Promise<void> {}

  async reapExpired(leases: readonly FixtureLease[], now: Date): Promise<void> {
    this.reapCalls.push({ leases, now });
  }
}

class DiagnosticBoundaryError extends Error {
  readonly diagnostic: ReturnType<typeof fixtureDiagnostic>;

  constructor(diagnostic: ReturnType<typeof fixtureDiagnostic>) {
    super(diagnostic.message);
    this.diagnostic = diagnostic;
  }
}

function candidate(preconditions: Workflow['preconditions']): Candidate {
  const workflow: Workflow = {
    $schema: 'https://arxic.dev/schemas/workflow/v1.json',
    id: 'authentication.fixture-test',
    version: 1,
    title: 'Fixture test',
    domain: 'authentication',
    persona: 'registered-user',
    status: 'hypothesized',
    confidence: 0.5,
    scope: {
      commit: '0'.repeat(40),
      environment: 'local-test',
      browser: 'chromium',
    },
    preconditions,
    states: [{ id: 'before' }, { id: 'after' }],
    transitions: [
      {
        from: 'before',
        to: 'after',
        action: { intent: 'Act' },
        assertions: [{ intent: 'Outcome' }],
        evidenceRefs: ['src:fixture-test'],
      },
    ],
    negativeCases: [],
    verification: { requiredRuns: 2, screenshotCheckpoints: [], forbidNetworkErrors: true },
    evidenceRefs: ['src:fixture-test'],
  };
  return { id: workflow.id, title: workflow.title, evidenceRefs: workflow.evidenceRefs, workflow };
}
