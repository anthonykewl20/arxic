import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  EnvironmentHandshake,
  verifyAttestation,
  type AttestationPolicy,
  type TargetAttestation,
} from '..';

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

function sign(value: TargetAttestation, key: string): string {
  return createHmac('sha256', key).update(`${value.buildDigest}.${value.nonce}`).digest('hex');
}

describe('target-attestation sad paths resolve to blocked diagnostics', () => {
  it('refuses a production environment class by default as blocked', () => {
    const result = verifyAttestation(
      attestation({ environmentClass: 'production' }),
      { origin },
      policy(),
    );
    expect(result).toMatchObject({ ok: false, disposition: 'refused' });
    expect(result.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'ARXIC-ATTESTATION-PRODUCTION-LIKING',
        'ARXIC-ATTESTATION-OVERRIDE-MISSING',
        'ARXIC-ATTESTATION-ENV-CLASS-DENIED',
        'ARXIC-ATTESTATION-BUILD-DIGEST-MISMATCH',
        'ARXIC-ATTESTATION-RECEIPT-UNSIGNED',
      ]),
    );
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

  it('refuses a forged well-formed build receipt as blocked', () => {
    const result = verifyAttestation(
      attestation({ signedReceipt: 'a'.repeat(64) }),
      { origin },
      policy({ requireSignedReceipt: true, receiptKey: 'test-key' }),
    );
    expect(result).toMatchObject({
      disposition: 'refused',
      diagnostics: [{ code: 'ARXIC-ATTESTATION-RECEIPT-UNSIGNED', severity: 'blocked' }],
    });
  });

  it('refuses an unsigned non-local target even when receipt checking is not opted in', () => {
    const previewOrigin = 'https://preview.example';
    const result = verifyAttestation(
      attestation({
        environmentClass: 'preview',
        origin: previewOrigin,
        allowedOrigins: [previewOrigin],
      }),
      { origin: previewOrigin },
      policy({
        allowedOrigins: [previewOrigin],
        expectedBuildDigest: digest,
        receiptKey: 'operator-key',
      }),
    );
    expect(result.disposition).toBe('refused');
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      'ARXIC-ATTESTATION-RECEIPT-UNSIGNED',
    );
  });

  it('does not honor an explicit receipt opt-out for a non-local target', () => {
    const previewOrigin = 'https://preview.example';
    const result = verifyAttestation(
      attestation({
        environmentClass: 'preview',
        origin: previewOrigin,
        allowedOrigins: [previewOrigin],
      }),
      { origin: previewOrigin },
      policy({
        allowedOrigins: [previewOrigin],
        expectedBuildDigest: digest,
        requireSignedReceipt: false,
      }),
    );
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      'ARXIC-ATTESTATION-RECEIPT-UNSIGNED',
    );
  });

  it('refuses a self-listed non-local origin missing from the operator allowlist', () => {
    const foreignOrigin = 'https://foreign.example';
    const unsigned = attestation({
      environmentClass: 'preview',
      origin: foreignOrigin,
      allowedOrigins: [foreignOrigin],
    });
    const result = verifyAttestation(
      { ...unsigned, signedReceipt: sign(unsigned, 'operator-key') },
      { origin: foreignOrigin },
      policy({
        allowedOrigins: [],
        expectedBuildDigest: digest,
        receiptKey: 'operator-key',
      }),
    );
    expect(result).toMatchObject({
      disposition: 'refused',
      diagnostics: [{ code: 'ARXIC-ATTESTATION-ORIGIN-NOT-ALLOWED', severity: 'blocked' }],
    });
  });

  it('refuses a build digest that differs from independently discovered source lineage', () => {
    const previewOrigin = 'https://preview.example';
    const value = attestation({
      environmentClass: 'preview',
      origin: previewOrigin,
      allowedOrigins: [previewOrigin],
    });
    const result = verifyAttestation(
      { ...value, signedReceipt: sign(value, 'operator-key') },
      { origin: previewOrigin },
      policy({
        allowedOrigins: [previewOrigin],
        expectedBuildDigest: 'b'.repeat(64),
        receiptKey: 'operator-key',
      }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'ARXIC-ATTESTATION-BUILD-DIGEST-MISMATCH',
        severity: 'blocked',
      }),
    );
  });

  it('refuses a receipt replayed with a stale nonce', () => {
    const previewOrigin = 'https://preview.example';
    const stale = attestation({
      environmentClass: 'preview',
      origin: previewOrigin,
      allowedOrigins: [previewOrigin],
      nonce: 'stale-nonce',
    });
    const result = verifyAttestation(
      { ...stale, signedReceipt: sign(stale, 'operator-key') },
      { origin: previewOrigin },
      policy({
        allowedOrigins: [previewOrigin],
        expectedNonce: 'fresh-nonce',
        expectedBuildDigest: digest,
        receiptKey: 'operator-key',
      }),
    );
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      'ARXIC-ATTESTATION-NONCE-MISMATCH',
    );
  });

  it('refuses a receipt after any signed attestation field is tampered', () => {
    const previewOrigin = 'https://preview.example';
    const original = attestation({
      environmentClass: 'preview',
      origin: previewOrigin,
      allowedOrigins: [previewOrigin],
    });
    const result = verifyAttestation(
      {
        ...original,
        signedReceipt: `${sign(original, 'operator-key').slice(0, -1)}0`,
      },
      { origin: previewOrigin },
      policy({
        allowedOrigins: [previewOrigin],
        expectedBuildDigest: digest,
        receiptKey: 'operator-key',
      }),
    );
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      'ARXIC-ATTESTATION-RECEIPT-UNSIGNED',
    );
  });

  it('fails closed when a non-local policy has no operator allowlist', () => {
    const previewOrigin = 'https://preview.example';
    const value = attestation({
      environmentClass: 'preview',
      origin: previewOrigin,
      allowedOrigins: [previewOrigin],
    });
    const result = verifyAttestation(
      { ...value, signedReceipt: sign(value, 'operator-key') },
      { origin: previewOrigin },
      policy({ allowedOrigins: [], expectedBuildDigest: digest, receiptKey: 'operator-key' }),
    );
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      'ARXIC-ATTESTATION-ORIGIN-NOT-ALLOWED',
    );
  });

  it('treats the target-served origin list as advisory for a local-test target', () => {
    const result = verifyAttestation(
      attestation({ allowedOrigins: ['http://localhost:9999'] }),
      { origin },
      policy(),
    );
    expect(result).toMatchObject({ disposition: 'allowed', diagnostics: [] });
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

  it('refuses a malformed approval record as override-missing instead of fetch-failed', () => {
    const malformedPolicy = policy({
      allowedEnvironmentClasses: ['local-test', 'production'],
      humanApprovals: { [origin]: { approver: undefined } } as unknown as Record<
        string,
        { approver: string; approvedAt: string; reason: string }
      >,
    });
    const result = verifyAttestation(
      attestation({ environmentClass: 'production' }),
      { origin },
      malformedPolicy,
    );
    expect(result.disposition).toBe('refused');
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      'ARXIC-ATTESTATION-OVERRIDE-MISSING',
    );
  });

  it('refuses a hanging attestation endpoint after the configured timeout', async () => {
    const server = createServer(() => undefined);
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not allocate a port');
    const hangingOrigin = `http://127.0.0.1:${address.port}`;
    try {
      const result = await new EnvironmentHandshake().attest(
        { origin: hangingOrigin },
        { allowedOrigins: [hangingOrigin], attestationTimeoutMs: 20 },
      );
      expect(result).toMatchObject({
        disposition: 'refused',
        diagnostics: [{ code: 'ARXIC-ATTESTATION-FETCH-FAILED', severity: 'blocked' }],
      });
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });
});
