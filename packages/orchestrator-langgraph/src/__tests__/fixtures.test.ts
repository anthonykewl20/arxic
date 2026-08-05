import type { FixtureLease, FixtureProvider, FixtureRequirement, Workflow } from '@arxic/contracts';
import { describe, expect, test } from 'vitest';
import {
  ARXIC_FIXTURE_INBOX_MISSING,
  ARXIC_FIXTURE_LEASE_LEAK,
  ARXIC_FIXTURE_MISSING,
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

  constructor(leak = false) {
    this.#leak = leak;
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
  }

  async release(lease: FixtureLease): Promise<void> {
    this.releaseIds.push(lease.id);
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
