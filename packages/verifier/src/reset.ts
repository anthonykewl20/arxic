import type { Diagnostic } from '@arxic/contracts';
import { ARXIC_VERIFY_BLOCKED_FIXTURE, verifyDiagnostic } from './diagnostics';

export type VerificationPersona = {
  email: string;
  password: string;
  [key: string]: string | undefined;
};

export class FixtureResetError extends Error {
  readonly diagnostic: Diagnostic;

  constructor(diagnostic: Diagnostic) {
    super(diagnostic.message);
    this.name = 'FixtureResetError';
    this.diagnostic = diagnostic;
  }
}

export async function resetAndSeedFixtures(
  origin: string,
  persona: VerificationPersona,
): Promise<void> {
  const base = new URL(origin);
  try {
    const reset = await fetch(new URL('/__arxic/reset', base), { method: 'POST' });
    if (!reset.ok) throw new Error(`Fixture reset returned ${reset.status}`);
    const seed = await fetch(new URL('/__arxic/seed', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personaId: 'arxic-verifier-user', ...persona }),
    });
    if (!seed.ok) throw new Error(`Fixture seed returned ${seed.status}`);
  } catch (error) {
    throw new FixtureResetError(
      verifyDiagnostic(
        ARXIC_VERIFY_BLOCKED_FIXTURE,
        'blocked',
        'verification.fixture',
        `Fixture reset/seed failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }
}
