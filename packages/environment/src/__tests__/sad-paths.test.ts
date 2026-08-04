import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyAttestation, type AttestationPolicy, type TargetAttestation } from '..';

const origin = 'http://localhost:4312';
const digest = createHash('sha256').update('build-1').digest('hex');
const attestation = (overrides: Partial<TargetAttestation> = {}): TargetAttestation => ({
  environmentClass: 'local-test',
  origin,
  allowedOrigins: [origin],
  buildDigest: digest,
  nonce: 'fixture-nonce',
  ...overrides,
});
const policy = (overrides: Partial<AttestationPolicy> = {}): AttestationPolicy => ({
  allowedOrigins: [origin],
  expectedNonce: 'fixture-nonce',
  now: () => '2026-08-05T12:00:00.000Z',
  ...overrides,
});

describe('target-attestation sad paths resolve to blocked diagnostics', () => {
  it('refuses a production environment class by default as blocked', () => {
    const result = verifyAttestation(
      attestation({ environmentClass: 'production' }),
      { origin },
      policy(),
    );
    expect(result).toMatchObject({ ok: false, disposition: 'refused' });
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      'ARXIC-ATTESTATION-PRODUCTION-LIKING',
      'ARXIC-ATTESTATION-OVERRIDE-MISSING',
      'ARXIC-ATTESTATION-ENV-CLASS-DENIED',
    ]);
  });

  it('refuses a public non-test hostname by default as blocked', () => {
    const publicOrigin = 'https://accounts.company.com';
    const result = verifyAttestation(
      attestation({ origin: publicOrigin, allowedOrigins: [publicOrigin] }),
      { origin: publicOrigin },
      policy({ allowedOrigins: [publicOrigin] }),
    );
    expect(result.disposition).toBe('refused');
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      'ARXIC-ATTESTATION-PRODUCTION-LIKING',
    );
  });

  it('refuses a missing or invalid expected nonce as blocked', () => {
    const result = verifyAttestation(attestation({ nonce: '' }), { origin }, policy());
    expect(result).toMatchObject({
      disposition: 'refused',
      diagnostics: [{ code: 'ARXIC-ATTESTATION-NONCE-MISMATCH', severity: 'blocked' }],
    });
  });

  it('refuses an unsigned build receipt as blocked', () => {
    const result = verifyAttestation(
      attestation(),
      { origin },
      policy({ requireSignedReceipt: true, receiptKey: 'test-key' }),
    );
    expect(result).toMatchObject({
      disposition: 'refused',
      diagnostics: [{ code: 'ARXIC-ATTESTATION-RECEIPT-UNSIGNED', severity: 'blocked' }],
    });
  });

  it('refuses any request, attestation, target list, or policy origin mismatch as blocked', () => {
    const result = verifyAttestation(
      attestation({ allowedOrigins: ['http://localhost:9999'] }),
      { origin },
      policy(),
    );
    expect(result).toMatchObject({
      disposition: 'refused',
      diagnostics: [{ code: 'ARXIC-ATTESTATION-ORIGIN-NOT-ALLOWED', severity: 'blocked' }],
    });
  });

  it('refuses an override attempted without static recorded human approval as blocked', () => {
    const result = verifyAttestation(
      attestation({ environmentClass: 'production' }),
      { origin },
      policy({ allowedEnvironmentClasses: ['local-test', 'production'] }),
    );
    expect(result.disposition).toBe('refused');
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      'ARXIC-ATTESTATION-OVERRIDE-MISSING',
    );
    expect(result.decision.override).toBeUndefined();
  });
});
