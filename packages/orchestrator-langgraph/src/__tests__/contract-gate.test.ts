import { validateDiagnostic } from '@arxic/contracts';
import { describe, expect, it } from 'vitest';
import { ORCH_DIAGNOSTIC_CODES, orchDiagnostic } from '..';

describe('orchestrator diagnostic contract gate', () => {
  it('loop-closes every exported ARXIC-ORCH code through the frozen validator', () => {
    for (const code of ORCH_DIAGNOSTIC_CODES) {
      expect(code).toMatch(/^ARXIC-ORCH-[A-Z0-9-]+$/u);
      expect(
        validateDiagnostic(orchDiagnostic(code, 'blocked', 'contract-gate', 'stable diagnostic')),
      ).toEqual(expect.objectContaining({ ok: true }));
    }
  });
});
