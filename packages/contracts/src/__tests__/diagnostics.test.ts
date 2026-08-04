import { describe, expect, it } from 'vitest';
import * as diagnosticsModule from '../diagnostics';
import {
  ARXIC_DIAGNOSTIC_CODE_FORMAT,
  ARXIC_DIAGNOSTIC_INVALID,
  ARXIC_DIAGNOSTIC_SEVERITY_UNKNOWN,
  validateDiagnostic,
} from '..';

const diagnostic = {
  code: 'ARXIC-RUNTIME-004',
  severity: 'blocked',
  subject: 'auth.mfa.enroll',
  message: 'No safe test fixture can provision an MFA-capable user.',
  evidenceRefs: ['src:mfa-controller', 'config:idp-provider'],
  supportedFixes: ['Configure PersonaProvisioner', 'Provide a disposable seeded account'],
};

const expectCode = (input: unknown, code: string) => {
  const result = validateDiagnostic(input);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.diagnostics.map((item) => item.code)).toContain(code);
  }
};

describe('Diagnostic contract', () => {
  it('rejects a missing required field with a stable diagnostic', () => {
    const { code, ...input } = diagnostic;
    expect(code).toBe('ARXIC-RUNTIME-004');
    expectCode(input, ARXIC_DIAGNOSTIC_INVALID);
  });

  it.each(['verified', 'error'])('rejects the unknown severity %s', (severity) => {
    expectCode({ ...diagnostic, severity }, ARXIC_DIAGNOSTIC_SEVERITY_UNKNOWN);
  });

  it.each(['warn-001', 'arxic-lower-1'])('rejects the malformed code %s', (code) => {
    expectCode({ ...diagnostic, code }, ARXIC_DIAGNOSTIC_CODE_FORMAT);
  });

  it('rejects an extra property', () => {
    expectCode({ ...diagnostic, unknown: true }, ARXIC_DIAGNOSTIC_INVALID);
  });

  it('rejects a deliberately wrong ADR-shaped diagnostic with an empty message', () => {
    expectCode({ ...diagnostic, message: '' }, ARXIC_DIAGNOSTIC_INVALID);
  });

  it('accepts every exported ARXIC code as a frozen Diagnostic code', () => {
    const codes = Object.values(diagnosticsModule).filter(
      (value) => typeof value === 'string' && value.startsWith('ARXIC-'),
    );
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(code).toMatch(/^ARXIC-[A-Z0-9][A-Z0-9-]*$/);
      expect(
        validateDiagnostic({ code, severity: 'blocked', subject: 'test', message: 'test' }),
      ).toEqual({
        ok: true,
        value: { code, severity: 'blocked', subject: 'test', message: 'test' },
      });
    }
  });

  it('accepts the ADR Diagnostics literal including a config evidence ref', () => {
    expect(validateDiagnostic(diagnostic)).toEqual({ ok: true, value: diagnostic });
  });
});
