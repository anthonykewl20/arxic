import type {
  Diagnostic,
  FixtureLease,
  FixtureProvider,
  FixtureRequirement,
} from '@arxic/contracts';
import { validateDiagnostic } from '@arxic/contracts';
import type { Candidate, FixturePreparation } from './types';

export const ARXIC_FIXTURE_MISSING = 'ARXIC-FIXTURE-MISSING' as const;
export const ARXIC_FIXTURE_LEASE_LEAK = 'ARXIC-FIXTURE-LEASE-LEAK' as const;
export const ARXIC_FIXTURE_SECRET_LEAK = 'ARXIC-FIXTURE-SECRET-LEAK' as const;
export const ARXIC_FIXTURE_INBOX_MISSING = 'ARXIC-FIXTURE-INBOX-MISSING' as const;
export const ARXIC_FIXTURE_UNKNOWN_DB = 'ARXIC-FIXTURE-UNKNOWN-DB' as const;

export type FixtureDiagnosticCode =
  | typeof ARXIC_FIXTURE_MISSING
  | typeof ARXIC_FIXTURE_LEASE_LEAK
  | typeof ARXIC_FIXTURE_SECRET_LEAK
  | typeof ARXIC_FIXTURE_INBOX_MISSING
  | typeof ARXIC_FIXTURE_UNKNOWN_DB;

type OutstandingLease = Readonly<{ lease: FixtureLease; provider: FixtureProvider }>;

export function fixtureDiagnostic(
  code: FixtureDiagnosticCode,
  subject: string,
  message: string,
): Diagnostic {
  const diagnostic: Diagnostic = { code, severity: 'blocked', subject, message };
  if (!validateDiagnostic(diagnostic).ok)
    throw new Error('fixture coordinator made an invalid Diagnostic');
  return diagnostic;
}

export class FixtureCoordinator {
  readonly #providers: readonly FixtureProvider[];
  readonly #outstanding = new Map<string, OutstandingLease>();

  constructor(providers: readonly FixtureProvider[]) {
    this.#providers = [...providers];
  }

  async prepare(input: { candidates: readonly Candidate[] }): Promise<FixturePreparation> {
    const requirements = candidateRequirements(input.candidates);
    const artifactRequirements = requirements.map(redactRequirement);
    if (this.#outstanding.size > 0) {
      const leaked = [...this.#outstanding.values()];
      await this.#cleanup(leaked);
      return blockedPreparation(
        artifactRequirements,
        fixtureDiagnostic(
          ARXIC_FIXTURE_LEASE_LEAK,
          'fixture-coordinator',
          'A prior run left an unreleased fixture lease; it was reset and released',
        ),
      );
    }
    const provisioned: OutstandingLease[] = [];
    for (const requirement of requirements) {
      const provider = this.#provider(requirement);
      if (!provider) {
        await this.#cleanup(provisioned);
        return blockedPreparation(
          artifactRequirements,
          fixtureDiagnostic(
            ARXIC_FIXTURE_MISSING,
            requirement.kind,
            `No registered fixture provider supports required kind ${requirement.kind}`,
          ),
        );
      }
      let lease: FixtureLease;
      try {
        lease = await provider.provision(requirement);
      } catch (error) {
        await this.#cleanup(provisioned);
        return blockedPreparation(artifactRequirements, diagnosticFromError(error, requirement));
      }
      if (containsSensitiveFixtureValue(lease, requirement)) {
        await this.#cleanup([...provisioned, { lease, provider }]);
        return blockedPreparation(
          artifactRequirements,
          fixtureDiagnostic(
            ARXIC_FIXTURE_SECRET_LEAK,
            requirement.kind,
            'A fixture provider exposed secret or personal data in a lease artifact',
          ),
        );
      }
      if (this.#outstanding.has(lease.id)) {
        await this.#cleanup([...provisioned, { lease, provider }]);
        return blockedPreparation(
          artifactRequirements,
          fixtureDiagnostic(
            ARXIC_FIXTURE_LEASE_LEAK,
            requirement.kind,
            'A fixture provider returned a lease id that is already outstanding',
          ),
        );
      }
      const outstanding = { lease, provider };
      provisioned.push(outstanding);
      this.#outstanding.set(lease.id, outstanding);
    }
    return {
      requirements: artifactRequirements,
      leases: provisioned.map(({ lease }) => lease),
      diagnostics: [],
      provisioned: true,
    };
  }

  async release(leases: readonly FixtureLease[]): Promise<void> {
    for (const lease of leases) {
      const outstanding = this.#outstanding.get(lease.id);
      if (!outstanding) continue;
      await outstanding.provider.release(outstanding.lease);
      this.#outstanding.delete(lease.id);
    }
  }

  #provider(requirement: FixtureRequirement): FixtureProvider | undefined {
    for (const provider of this.#providers) {
      try {
        if (provider.supports(requirement)) return provider;
      } catch {
        continue;
      }
    }
    return undefined;
  }

  async #cleanup(outstanding: readonly OutstandingLease[]): Promise<void> {
    for (const item of outstanding) {
      const reset = await attemptCleanup(() => item.provider.reset(item.lease));
      const released = await attemptCleanup(() => item.provider.release(item.lease));
      if (reset && released) {
        this.#outstanding.delete(item.lease.id);
      }
    }
  }
}

async function attemptCleanup(operation: () => Promise<void>): Promise<boolean> {
  try {
    await operation();
    return true;
  } catch {
    return false;
  }
}

function candidateRequirements(candidates: readonly Candidate[]): FixtureRequirement[] {
  return candidates.flatMap(
    (candidate) =>
      candidate.workflow?.preconditions.map((requirement) => ({
        kind: requirement.fixture,
        ...(requirement.parameters ? { parameters: requirement.parameters } : {}),
      })) ?? [],
  );
}

function blockedPreparation(
  requirements: readonly FixtureRequirement[],
  diagnostic: Diagnostic,
): FixturePreparation {
  return { requirements, leases: [], diagnostics: [diagnostic], provisioned: false };
}

function containsSensitiveFixtureValue(
  lease: FixtureLease,
  requirement: FixtureRequirement,
): boolean {
  const serialized = JSON.stringify(lease);
  const sensitive = collectSensitiveFixtureValues(requirement);
  return sensitive.some((value) => serialized.includes(value));
}

function redactRequirement(requirement: FixtureRequirement): FixtureRequirement {
  const parameters = Object.fromEntries(
    Object.entries(requirement.parameters ?? {}).map(([key, value]) => [key, redactValue(value)]),
  );
  return {
    kind: requirement.kind,
    ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
  };
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return '[REDACTED]';
  }
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item)]));
  }
  return value;
}

function collectSensitiveFixtureValues(requirement: FixtureRequirement): string[] {
  const values: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.length > 0) values.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(requirement.parameters);
  return values;
}

function diagnosticFromError(error: unknown, requirement: FixtureRequirement): Diagnostic {
  if (error && typeof error === 'object' && 'diagnostic' in error) {
    const validation = validateDiagnostic(error.diagnostic);
    if (validation.ok && validation.value.code.startsWith('ARXIC-FIXTURE-')) {
      const sensitive = collectSensitiveFixtureValues(requirement);
      if (
        sensitive.some(
          (value) =>
            validation.value.message.includes(value) || validation.value.subject.includes(value),
        )
      ) {
        const message =
          'Fixture provider returned a diagnostic containing a sensitive value; redacted';
        return { ...validation.value, subject: message, message };
      }
      return validation.value;
    }
  }
  if (error && typeof error === 'object' && 'code' in error) {
    const code = error.code;
    if (code === ARXIC_FIXTURE_SECRET_LEAK) {
      return fixtureDiagnostic(
        code,
        requirement.kind,
        'OTP fixture data was invalid or could not be retained safely',
      );
    }
  }
  return fixtureDiagnostic(
    ARXIC_FIXTURE_MISSING,
    requirement.kind,
    'The required fixture provider could not safely provision a lease',
  );
}
