import { validateDiagnostic } from '@arxic/contracts';
import { describe, expect, it } from 'vitest';

describe('diagnostics contract gate (loop-close through the frozen validator)', () => {
  it('every exported ARXIC-PROPOSAL_* code produces a contract-valid blocked diagnostic', async () => {
    const diagnostics = await import('../diagnostics');
    const codes = Object.entries(diagnostics).filter(
      ([key, value]) =>
        key.startsWith('ARXIC_PROPOSAL_') &&
        typeof value === 'string' &&
        value.startsWith('ARXIC-'),
    );
    expect(codes.length).toBeGreaterThanOrEqual(4);
    for (const [, code] of codes) {
      const result = diagnostics.proposalDiagnostic(
        code as Parameters<typeof diagnostics.proposalDiagnostic>[0],
        'blocked',
        'contract-gate',
        'loop-close probe',
      );
      expect(result.code).toBe(code);
      expect(validateDiagnostic(result)).toMatchObject({ ok: true });
    }
  });

  it('rejects a fabricated severity (verified is not a diagnostic severity)', async () => {
    const { proposalDiagnostic } = await import('../diagnostics');
    expect(() =>
      proposalDiagnostic('ARXIC-PROPOSAL-DUPLICATE', 'verified' as never, 'x', 'probe'),
    ).toThrow();
  });
});
