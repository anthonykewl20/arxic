import type {
  Diagnostic,
  FixtureLease,
  FixtureProvider,
  FixtureRequirement,
} from '@arxic/contracts';
import { validateDiagnostic } from '@arxic/contracts';
import type { Candidate, FixtureLeaseState, FixturePreparation } from './types';

export const ARXIC_FIXTURE_MISSING = 'ARXIC-FIXTURE-MISSING' as const;
export const ARXIC_FIXTURE_LEASE_LEAK = 'ARXIC-FIXTURE-LEASE-LEAK' as const;
export const ARXIC_FIXTURE_SECRET_LEAK = 'ARXIC-FIXTURE-SECRET-LEAK' as const;
export const ARXIC_FIXTURE_INBOX_MISSING = 'ARXIC-FIXTURE-INBOX-MISSING' as const;
export const ARXIC_FIXTURE_UNKNOWN_DB = 'ARXIC-FIXTURE-UNKNOWN-DB' as const;
export const ARXIC_FIXTURE_RELEASE_FAILED = 'ARXIC-FIXTURE-RELEASE-FAILED' as const;
export const ARXIC_FIXTURE_RESET_FAILED = 'ARXIC-FIXTURE-RESET-FAILED' as const;

export type FixtureDiagnosticCode =
  | typeof ARXIC_FIXTURE_MISSING
  | typeof ARXIC_FIXTURE_LEASE_LEAK
  | typeof ARXIC_FIXTURE_SECRET_LEAK
  | typeof ARXIC_FIXTURE_INBOX_MISSING
  | typeof ARXIC_FIXTURE_UNKNOWN_DB
  | typeof ARXIC_FIXTURE_RELEASE_FAILED
  | typeof ARXIC_FIXTURE_RESET_FAILED;

type OutstandingLease = Readonly<{ lease: FixtureLeaseState; provider: FixtureProvider }>;
type ReapableFixtureProvider = FixtureProvider &
  Readonly<{ reapExpired?: (leases: readonly FixtureLease[], now: Date) => Promise<void> }>;

const DEFAULT_LEASE_DURATION_MS = 5 * 60 * 1000;

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
  readonly #deferredDiagnostics: Diagnostic[] = [];
  readonly #now: () => Date;

  constructor(providers: readonly FixtureProvider[], options: Readonly<{ now?: () => Date }> = {}) {
    this.#providers = [...providers];
    this.#now = options.now ?? (() => new Date());
  }

  async prepare(input: {
    candidates: readonly Candidate[];
    runId?: string;
  }): Promise<FixturePreparation> {
    const requirements = candidateRequirements(input.candidates);
    const artifactRequirements = requirements.map(redactRequirement);
    const diagnostics = this.#deferredDiagnostics.splice(0);
    const owner = input.runId ?? 'fixture-coordinator';
    const now = this.#now();
    const expired = [...this.#outstanding.values()].filter(
      ({ lease }) => lease.owner !== owner && Date.parse(lease.expiresAt) <= now.getTime(),
    );
    for (const { lease } of expired) {
      this.#outstanding.delete(lease.id);
      diagnostics.push(
        cleanupDiagnostic(
          ARXIC_FIXTURE_LEASE_LEAK,
          'fixture-coordinator',
          'Expired foreign fixture lease was dropped from coordinator tracking without provider cleanup',
        ),
      );
    }
    if (this.#outstanding.size > 0) {
      const leaked = [...this.#outstanding.values()];
      const owned = leaked.filter(({ lease }) => lease.owner === owner);
      diagnostics.push(...(await this.#cleanup(owned, true)));
      return blockedPreparation(artifactRequirements, [
        ...diagnostics,
        fixtureDiagnostic(
          ARXIC_FIXTURE_LEASE_LEAK,
          'fixture-coordinator',
          'A prior run left an unreleased fixture lease; preparation is blocked',
        ),
      ]);
    }
    const provisioned: OutstandingLease[] = [];
    for (const requirement of requirements) {
      const provider = this.#provider(requirement);
      if (!provider) {
        diagnostics.push(...(await this.#cleanup(provisioned, true)));
        return blockedPreparation(artifactRequirements, [
          ...diagnostics,
          fixtureDiagnostic(
            ARXIC_FIXTURE_MISSING,
            requirement.kind,
            `No registered fixture provider supports required kind ${requirement.kind}`,
          ),
        ]);
      }
      let provisionedLease: FixtureLease;
      try {
        provisionedLease = await provider.provision(requirement);
      } catch (error) {
        diagnostics.push(...(await this.#cleanup(provisioned, true)));
        return blockedPreparation(artifactRequirements, [
          ...diagnostics,
          diagnosticFromError(error, requirement),
        ]);
      }
      if (containsSensitiveFixtureValue(provisionedLease, requirement)) {
        diagnostics.push(
          ...(await this.#cleanup(
            [
              ...provisioned,
              { lease: this.#managedLease(provisionedLease, input.runId), provider },
            ],
            true,
          )),
        );
        return blockedPreparation(artifactRequirements, [
          ...diagnostics,
          fixtureDiagnostic(
            ARXIC_FIXTURE_SECRET_LEAK,
            requirement.kind,
            'A fixture provider exposed secret or personal data in a lease artifact',
          ),
        ]);
      }
      const lease = this.#managedLease(provisionedLease, input.runId);
      if (this.#outstanding.has(lease.id)) {
        diagnostics.push(...(await this.#cleanup([...provisioned, { lease, provider }], true)));
        return blockedPreparation(artifactRequirements, [
          ...diagnostics,
          fixtureDiagnostic(
            ARXIC_FIXTURE_LEASE_LEAK,
            requirement.kind,
            'A fixture provider returned a lease id that is already outstanding',
          ),
        ]);
      }
      const outstanding = { lease, provider };
      provisioned.push(outstanding);
      this.#outstanding.set(lease.id, outstanding);
    }
    return {
      requirements: artifactRequirements,
      leases: provisioned.map(({ lease }) => lease),
      diagnostics,
      provisioned: true,
    };
  }

  async release(leases: readonly FixtureLease[]): Promise<readonly Diagnostic[]> {
    const diagnostics: Diagnostic[] = [];
    const outstanding = leases.flatMap((lease) => {
      const outstanding = this.#outstanding.get(lease.id);
      if (outstanding) return [outstanding];
      diagnostics.push(
        cleanupDiagnostic(
          ARXIC_FIXTURE_RELEASE_FAILED,
          lease.id,
          'Fixture lease was not registered for release',
        ),
      );
      return [];
    });
    return [...diagnostics, ...(await this.#cleanup(outstanding, true))];
  }

  /** Explicit maintenance only; normal fixture lifecycle never invokes provider reaping. */
  async reapExpiredLeases(
    leases: readonly FixtureLeaseState[],
    now: Date = this.#now(),
  ): Promise<readonly Diagnostic[]> {
    const groups = new Map<ReapableFixtureProvider, FixtureLeaseState[]>();
    for (const lease of leases) {
      const provider = this.#provider(lease.requirement) as ReapableFixtureProvider | undefined;
      if (!provider?.reapExpired) continue;
      const group = groups.get(provider) ?? [];
      group.push(lease);
      groups.set(provider, group);
    }
    const diagnostics: Diagnostic[] = [];
    for (const [provider, providerLeases] of groups) {
      try {
        await provider.reapExpired!(providerLeases, now);
      } catch {
        diagnostics.push(
          cleanupDiagnostic(
            ARXIC_FIXTURE_RELEASE_FAILED,
            'fixture-provider-reaper',
            'Fixture provider could not reap explicitly supplied expired leases',
          ),
        );
      }
    }
    return diagnostics;
  }

  rehydrate(
    leases: readonly FixtureLeaseState[],
    now: Date = this.#now(),
  ): readonly FixtureLeaseState[] {
    const renewed: FixtureLeaseState[] = [];
    for (const lease of leases) {
      const refreshed = {
        ...lease,
        expiresAt: renewedExpiry(lease.expiresAt, now).toISOString(),
      };
      renewed.push(refreshed);
      if (this.#outstanding.has(lease.id)) continue;
      const provider = this.#provider(lease.requirement);
      if (provider) this.#outstanding.set(lease.id, { lease: refreshed, provider });
    }
    return renewed;
  }

  #managedLease(lease: FixtureLease, runId: string | undefined): FixtureLeaseState {
    return {
      ...lease,
      owner: runId ?? 'fixture-coordinator',
      expiresAt:
        lease.expiresAt ??
        new Date(this.#now().getTime() + DEFAULT_LEASE_DURATION_MS).toISOString(),
      inUse: false,
    };
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

  async #cleanup(
    outstanding: readonly OutstandingLease[],
    recordDroppedLeak = false,
  ): Promise<readonly Diagnostic[]> {
    const diagnostics: Diagnostic[] = [];
    for (const item of outstanding) {
      const fixtureReset = await attemptCleanup(() => item.provider.reset(item.lease));
      const released = await attemptCleanup(() => item.provider.release(item.lease));
      if (!fixtureReset) {
        diagnostics.push(
          cleanupDiagnostic(
            ARXIC_FIXTURE_RESET_FAILED,
            item.lease.id,
            'Fixture reset failed during terminal cleanup',
          ),
        );
      }
      if (!released) {
        diagnostics.push(
          cleanupDiagnostic(
            ARXIC_FIXTURE_RELEASE_FAILED,
            item.lease.id,
            'Fixture release failed during terminal cleanup',
          ),
        );
      }
      this.#outstanding.delete(item.lease.id);
      if ((!fixtureReset || !released) && recordDroppedLeak) {
        this.#deferredDiagnostics.push(
          cleanupDiagnostic(
            ARXIC_FIXTURE_LEASE_LEAK,
            'fixture-coordinator',
            'Terminal fixture cleanup failed; dropped lease tracking so a later run is not permanently blocked',
          ),
        );
      }
    }
    return diagnostics;
  }
}

function renewedExpiry(current: string, now: Date): Date {
  const renewed = new Date(now.getTime() + DEFAULT_LEASE_DURATION_MS);
  const currentExpiry = new Date(current);
  return Number.isNaN(currentExpiry.getTime()) || currentExpiry < renewed ? renewed : currentExpiry;
}

async function attemptCleanup(operation: () => Promise<void>): Promise<boolean> {
  try {
    await operation();
    return true;
  } catch {
    return false;
  }
}

function cleanupDiagnostic(
  code: FixtureDiagnosticCode,
  subject: string,
  message: string,
): Diagnostic {
  const diagnostic: Diagnostic = {
    code,
    severity: 'observed',
    subject,
    message,
  };
  if (!validateDiagnostic(diagnostic).ok) throw new Error('Invalid fixture cleanup Diagnostic');
  return diagnostic;
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
  diagnostics: readonly Diagnostic[],
): FixturePreparation {
  return { requirements, leases: [], diagnostics, provisioned: false };
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
