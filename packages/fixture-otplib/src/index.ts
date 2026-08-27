import { randomUUID } from 'node:crypto';
import type { FixtureLease, FixtureProvider, FixtureRequirement } from '@arxic/contracts';
// NOTE(otplib pin): otplib is pinned to ^12.0.1 -- otplib 13.x removed the
// 'authenticator' export in a full functional/class-based rewrite, breaking this
// import. Do not bump past 12.x without migrating to the new async OTP API.
import { authenticator } from 'otplib';

export const PACKAGE_NAME = '@arxic/fixture-otplib' as const;
export const ARXIC_FIXTURE_SECRET_LEAK = 'ARXIC-FIXTURE-SECRET-LEAK' as const;

type OtpFixture = Readonly<{ secret: string; digits: number }>;

export class OtpFixtureError extends Error {
  readonly code = ARXIC_FIXTURE_SECRET_LEAK;
  readonly severity = 'blocked' as const;

  constructor(message: string) {
    super(message);
    this.name = 'OtpFixtureError';
  }
}

export class OtpAdapter implements FixtureProvider {
  readonly #fixtures = new Map<string, OtpFixture>();

  supports(requirement: FixtureRequirement): boolean {
    return requirement.kind === 'otp';
  }

  async provision(requirement: FixtureRequirement): Promise<FixtureLease> {
    if (!this.supports(requirement)) throw new OtpFixtureError('OTP fixture kind is required');
    const supplied = requirement.parameters?.secret;
    if (supplied !== undefined && !isSecret(supplied)) {
      throw new OtpFixtureError('OTP secret is invalid and was not retained');
    }
    const digits = requirement.parameters?.digits ?? 6;
    if (!Number.isInteger(digits) || (digits !== 6 && digits !== 8)) {
      throw new OtpFixtureError('OTP digits must be 6 or 8');
    }
    const secret = typeof supplied === 'string' ? supplied : authenticator.generateSecret();
    if (!isSecret(secret)) throw new OtpFixtureError('OTP secret generation failed');
    const id = `otp:${randomUUID()}`;
    this.#fixtures.set(id, { secret, digits });
    return {
      id,
      requirement: {
        kind: 'otp',
        parameters: { secret: '[REDACTED]', digits },
      },
    };
  }

  async reset(lease: FixtureLease): Promise<void> {
    this.#fixture(lease);
  }

  async release(lease: FixtureLease): Promise<void> {
    this.#fixtures.delete(lease.id);
  }

  generate(lease: FixtureLease): string {
    const fixture = this.#fixture(lease);
    return authenticator.clone({ digits: fixture.digits }).generate(fixture.secret);
  }

  validate(lease: FixtureLease, token: string): boolean {
    const fixture = this.#fixture(lease);
    return authenticator
      .clone({ digits: fixture.digits })
      .verify({ token, secret: fixture.secret });
  }

  #fixture(lease: FixtureLease): OtpFixture {
    const fixture = this.#fixtures.get(lease.id);
    if (!fixture) throw new OtpFixtureError('OTP lease is missing or released');
    return fixture;
  }
}

function isSecret(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z2-7]{16,128}$/u.test(value);
}
