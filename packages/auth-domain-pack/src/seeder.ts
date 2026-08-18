import type { ProposalConsumerRow } from '@arxic/domain-inventory';

/**
 * DG-08 DEMOTION (ADR-008 Decision 3): the auth domain pack becomes an
 * optional SEEDER/ADVISOR. This module emits DG-04-schema vNext proposals
 * (`arxic-intent-proposal-v1` wire shape — structurally identical to the
 * orchestrator's `SeededProposal`; the pack deliberately holds NO dependency
 * on the orchestrator, matching is structural) grounded in REAL Domain
 * Inventory rows.
 *
 * Demotion semantics: the seeder may SEED or ADVISE, never override. The
 * orchestrator merges this output through the SAME binding (dangling-citation
 * rejection) and dedupe gates as every model proposal; nothing here can skip
 * a gate, and pre-verified claims are worth nothing until the deterministic
 * verifier re-proves them. The pack's own capability knowledge (which route
 * shapes mean login/logout/reset) lives HERE — the one place domain literals
 * are allowed to exist.
 */

/** The single source of the domain literal this pack owns. */
export const AUTH_DOMAIN = 'authentication';

export type AuthSeededProposal = {
  readonly domain: typeof AUTH_DOMAIN;
  readonly intent: string;
  readonly action: string;
  readonly fromState: string;
  readonly toState: string;
  readonly persona: string;
  readonly inventoryRowIds: readonly string[];
  readonly evidenceRefIds: readonly string[];
  readonly rationale: string;
  readonly fixtureKinds: readonly string[];
};

type Capability = {
  readonly id: string;
  readonly intent: string;
  readonly fromState: string;
  readonly toState: string;
  readonly persona: string;
  readonly routePattern: RegExp;
  readonly fixtureKinds: readonly string[];
};

/**
 * Capability knowledge (pack-owned): which inventory route shapes indicate
 * which user-facing capability. Patterns are deliberately shape-based (not
 * reference-app literals): any app with a `/…login…` route offering a session
 * form seeds a login proposal.
 */
const CAPABILITIES: readonly Capability[] = [
  {
    id: 'login',
    intent: 'log in with credentials',
    fromState: 'signed-out',
    toState: 'signed-in',
    persona: 'registered-user',
    routePattern: /(?:^|\/)login(?:\/|$)/iu,
    fixtureKinds: ['persona'],
  },
  {
    id: 'logout',
    intent: 'log out of the current session',
    fromState: 'signed-in',
    toState: 'signed-out',
    persona: 'registered-user',
    routePattern: /(?:^|\/)logout(?:\/|$)/iu,
    fixtureKinds: ['persona'],
  },
  {
    id: 'reset-request',
    intent: 'request a password reset email',
    fromState: 'signed-out',
    toState: 'reset-requested',
    persona: 'registered-user',
    routePattern: /(?:^|\/)forgot(?:-password)?(?:\/|$)/iu,
    fixtureKinds: ['persona', 'inbox'],
  },
  {
    id: 'reset-complete',
    intent: 'complete a password reset with a token',
    fromState: 'reset-requested',
    toState: 'signed-out',
    persona: 'registered-user',
    routePattern: /(?:^|\/)reset(?:-password)?(?:\/|$)/iu,
    fixtureKinds: ['persona', 'inbox'],
  },
  {
    id: 'password-change',
    intent: 'change the account password',
    fromState: 'signed-in',
    toState: 'signed-in',
    persona: 'registered-user',
    routePattern: /(?:^|\/)change-password(?:\/|$)/iu,
    fixtureKinds: ['persona'],
  },
  {
    id: 'totp',
    intent: 'enroll or challenge a second factor',
    fromState: 'signed-in',
    toState: 'mfa-enrolled',
    persona: 'registered-user',
    routePattern: /(?:^|\/)mfa(?:\/|$)/iu,
    fixtureKinds: ['persona', 'totp'],
  },
];

/**
 * Seed auth-domain proposals from real inventory rows. Deterministic,
 * honest-zero: a capability with no matching row seeds NOTHING (no fabricated
 * surfaces — the pre-DG-08 `AuthSurface` fabrication class is gone).
 */
export function authDomainSeeder(input: {
  readonly rows: readonly ProposalConsumerRow[];
}): readonly AuthSeededProposal[] {
  const proposals: AuthSeededProposal[] = [];
  for (const capability of CAPABILITIES) {
    const matches = input.rows
      .filter((row) => capability.routePattern.test(row.path))
      .sort((left, right) => (left.id < right.id ? -1 : 1));
    if (matches.length === 0) continue;
    const row = matches[0]!;
    proposals.push({
      domain: AUTH_DOMAIN,
      intent: capability.intent,
      action: `perform ${row.method} ${row.path}`,
      fromState: capability.fromState,
      toState: capability.toState,
      persona: capability.persona,
      inventoryRowIds: [row.id],
      evidenceRefIds: [...row.evidenceIds],
      rationale: `seeded by the optional domain pack: route ${row.path} matches the ${capability.id} capability shape`,
      fixtureKinds: [...capability.fixtureKinds],
    });
  }
  return proposals;
}
