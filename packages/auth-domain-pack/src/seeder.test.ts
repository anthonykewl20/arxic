import { describe, expect, it } from 'vitest';
import { AUTH_DOMAIN, authDomainSeeder } from './seeder';
import type { ProposalConsumerRow } from '@arxic/domain-inventory';

/**
 * DG-08 auth pack DEMOTION (ADR-008 Decision 3): the pack becomes an optional
 * SEEDER/advisor. It emits DG-04-schema proposals grounded in real inventory
 * rows through the pack's own domain knowledge; it may seed/advise, never
 * override — the orchestrator merges seeder output through the SAME binding
 * and dedupe gates as model proposals (proven in the orchestrator suite).
 */

const COMMIT = 'a'.repeat(40);

function rows(paths: readonly string[]): ProposalConsumerRow[] {
  return paths.map((path, index) => ({
    id: `inv:page:GET:${String(index + 1).repeat(12)}`,
    surface: 'page' as const,
    method: 'GET',
    path,
    sourcePath: `app${path}/page.tsx`,
    domainHint: path.split('/').filter(Boolean)[0] ?? 'home',
    evidenceIds: [`src:row-${index}:1-5`],
  }));
}

describe('authDomainSeeder (demoted to optional seeder/advisor)', () => {
  it('seeds login and logout proposals grounded in the real inventory rows', () => {
    const inventory = rows(['/login', '/logout']);
    const seeded = authDomainSeeder({ rows: inventory });
    expect(seeded.length).toBeGreaterThanOrEqual(2);
    const intents = seeded.map((proposal) => proposal.intent);
    expect(intents.some((intent) => /log in/iu.test(intent))).toBe(true);
    expect(intents.some((intent) => /log out/iu.test(intent))).toBe(true);
    for (const proposal of seeded) {
      expect(proposal.domain).toBe(AUTH_DOMAIN);
      expect(AUTH_DOMAIN).toBe('authentication');
      expect(proposal.inventoryRowIds.length).toBeGreaterThanOrEqual(1);
      for (const id of proposal.inventoryRowIds) {
        expect(inventory.some((row) => row.id === id)).toBe(true);
      }
      for (const id of proposal.evidenceRefIds) {
        expect(inventory.some((row) => row.evidenceIds.includes(id))).toBe(true);
      }
      // Persona requirement is declared as fixture knowledge, not hidden.
      expect(proposal.fixtureKinds).toContain('persona');
      expect(typeof proposal.rationale).toBe('string');
    }
  });

  it('is honest: seeds nothing when no matching rows exist (no fabricated surfaces)', () => {
    const seeded = authDomainSeeder({ rows: rows(['/shop', '/cart']) });
    expect(seeded).toHaveLength(0);
  });

  it('seeds only capabilities whose characteristic rows exist (no reset without a reset route)', () => {
    const seeded = authDomainSeeder({ rows: rows(['/login']) });
    const intents = seeded.map((proposal) => proposal.intent).join(' ');
    expect(/reset/iu.test(intents)).toBe(false);
    expect(/password/iu.test(intents)).toBe(false);
  });

  it('is deterministic: identical rows produce identical proposals', () => {
    const inventory = rows(['/login', '/forgot-password', '/reset-password', '/change-password']);
    expect(authDomainSeeder({ rows: inventory })).toEqual(authDomainSeeder({ rows: inventory }));
  });

  it('seeds fixture-gated capabilities with their fixture kinds (honest accounting)', () => {
    const inventory = rows([
      '/login',
      '/forgot-password',
      '/reset-password',
      '/change-password',
      '/mfa/enroll',
    ]);
    const seeded = authDomainSeeder({ rows: inventory });
    const reset = seeded.find((proposal) => /reset/iu.test(proposal.intent));
    expect(reset?.fixtureKinds).toContain('inbox');
    const totp = seeded.find((proposal) => /second factor/iu.test(proposal.intent));
    expect(totp?.fixtureKinds).toContain('totp');
  });

  it('cites the row whose path matched the capability (verifiable grounding)', () => {
    const inventory = rows(['/login', '/logout']);
    const seeded = authDomainSeeder({ rows: inventory });
    for (const proposal of seeded) {
      const cited = inventory.filter((row) => proposal.inventoryRowIds.includes(row.id));
      expect(cited.length).toBeGreaterThanOrEqual(1);
      // A login proposal must cite a login-ish row, not an unrelated one.
      if (/log in/iu.test(proposal.intent)) {
        expect(cited.some((row) => row.path === '/login')).toBe(true);
      }
    }
  });
});

void COMMIT;
