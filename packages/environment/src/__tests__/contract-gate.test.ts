import { createHash, createHmac } from 'node:crypto';
import { validateDiagnostic } from '@arxic/contracts';
import { describe, expect, it } from 'vitest';
import * as exports from '..';
import {
  ATTESTATION_DIAGNOSTIC_CODES,
  classifyTarget,
  verifyAttestation,
  WORKER_DIAGNOSTIC_CODES,
  type TargetAttestation,
} from '..';

const digest = createHash('sha256').update('contract-build').digest('hex');

describe('ADR §23.14 target-attestation contract gate', () => {
  it('loop-closes every exported ARXIC-ATTESTATION code through the frozen validator', () => {
    const codes = (Object.values(exports) as unknown[]).filter(
      (value): value is string =>
        typeof value === 'string' && value.startsWith('ARXIC-ATTESTATION-'),
    );
    expect(codes.sort()).toEqual([...ATTESTATION_DIAGNOSTIC_CODES].sort());
    for (const code of codes) {
      expect(
        validateDiagnostic({
          code,
          severity: 'blocked',
          subject: 'contract-gate',
          message: 'test',
        }),
      ).toMatchObject({ ok: true });
    }
  });

  it('loop-closes every registered ARXIC-WORKER code through the frozen validator', () => {
    expect(new Set(WORKER_DIAGNOSTIC_CODES).size).toBe(WORKER_DIAGNOSTIC_CODES.length);
    expect(WORKER_DIAGNOSTIC_CODES.length).toBeGreaterThan(0);
    for (const code of WORKER_DIAGNOSTIC_CODES) {
      expect(code.startsWith('ARXIC-WORKER-')).toBe(true);
      expect(
        validateDiagnostic({
          code,
          severity: 'blocked',
          subject: 'contract-gate',
          message: 'test',
        }),
      ).toMatchObject({ ok: true });
    }
  });

  it('classifies loopback, private, and reserved suffixes apart from production-looking targets', () => {
    for (const origin of [
      'http://localhost:3000',
      'http://127.0.0.1',
      'http://[::1]',
      'http://10.2.3.4',
      'http://172.16.1.2',
      'http://192.168.4.5',
      'https://app.test',
      'https://app.example',
      'https://app.local',
    ]) {
      expect(classifyTarget({ origin, environmentClass: 'preview' }).productionLooking).toBe(false);
    }
    expect(
      classifyTarget({ origin: 'https://app.company.net', environmentClass: 'preview' }),
    ).toMatchObject({ productionLooking: true, reasons: ['public-hostname'] });
  });

  it('accepts an independently signed receipt and always records an allowed decision', () => {
    const origin = 'https://receipt.test';
    const nonce = 'one-time-nonce';
    const receiptKey = 'contract-key';
    const signedReceipt = createHmac('sha256', receiptKey)
      .update(`${digest}.${nonce}`)
      .digest('hex');
    const attestation: TargetAttestation = {
      environmentClass: 'preview',
      origin,
      allowedOrigins: [origin],
      buildDigest: digest,
      nonce,
      signedReceipt,
    };
    const result = verifyAttestation(
      attestation,
      { origin },
      {
        allowedOrigins: [origin],
        expectedNonce: nonce,
        expectedBuildDigest: digest,
        requireSignedReceipt: true,
        receiptKey,
        now: () => '2026-08-05T12:00:00.000Z',
      },
    );
    expect(result).toMatchObject({
      ok: true,
      disposition: 'allowed',
      diagnostics: [],
      decision: {
        target: origin,
        origin,
        environmentClass: 'preview',
        disposition: 'allowed',
        policyVersion: 'arxic-target-attestation-v1',
        timestamp: '2026-08-05T12:00:00.000Z',
      },
    });
  });

  it('always records a refused decision', () => {
    const origin = 'https://production.company.net';
    const attestation: TargetAttestation = {
      environmentClass: 'production',
      origin,
      allowedOrigins: [origin],
      buildDigest: digest,
      nonce: 'nonce',
    };
    const result = verifyAttestation(
      attestation,
      { origin },
      {
        allowedOrigins: [origin],
        expectedNonce: 'nonce',
        now: () => '2026-08-05T12:00:00.000Z',
      },
    );
    expect(result.decision).toMatchObject({
      target: origin,
      disposition: 'refused',
      environmentClass: 'production',
      policyVersion: 'arxic-target-attestation-v1',
    });
    expect(result.decision.reason).toContain('ARXIC-ATTESTATION-PRODUCTION-LIKING');
  });

  it('does not use a human approval to bypass a non-production environment denial', () => {
    const origin = 'https://staging.example';
    const approval = {
      approver: 'security-owner@example.test',
      approvedAt: '2026-08-05T11:30:00.000Z',
      reason: 'Approval is scoped to production-looking overrides',
    };
    const result = verifyAttestation(
      {
        environmentClass: 'staging',
        origin,
        allowedOrigins: [origin],
        buildDigest: digest,
        nonce: 'nonce',
      },
      { origin },
      {
        allowedOrigins: [origin],
        expectedNonce: 'nonce',
        humanApprovals: { [origin]: approval },
      },
    );
    expect(result.disposition).toBe('refused');
    expect(result.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'ARXIC-ATTESTATION-ENV-CLASS-DENIED',
        'ARXIC-ATTESTATION-BUILD-DIGEST-MISMATCH',
        'ARXIC-ATTESTATION-RECEIPT-UNSIGNED',
      ]),
    );
    expect(result.decision.override).toBeUndefined();
  });

  it('does not use a human approval to bypass a malformed origin', () => {
    const origin = 'not-a-web-origin';
    const approval = {
      approver: 'security-owner@example.test',
      approvedAt: '2026-08-05T11:30:00.000Z',
      reason: 'Malformed targets cannot be approved',
    };
    const result = verifyAttestation(
      {
        environmentClass: 'local-test',
        origin,
        allowedOrigins: [origin],
        buildDigest: digest,
        nonce: 'nonce',
      },
      { origin },
      {
        allowedOrigins: [origin],
        expectedNonce: 'nonce',
        humanApprovals: { [origin]: approval },
      },
    );
    expect(result.disposition).toBe('refused');
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      'ARXIC-ATTESTATION-ORIGIN-NOT-ALLOWED',
    );
  });
});
