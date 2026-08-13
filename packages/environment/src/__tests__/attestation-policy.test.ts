import { describe, expect, it } from 'vitest';
import { buildAttestationPolicy, operatorAttestationSettings } from '..';

describe('operator-controlled attestation policy', () => {
  it('fails closed for non-local targets when operator settings are absent', () => {
    const policy = buildAttestationPolicy({ origin: 'https://target.example' });
    expect(policy).toMatchObject({
      allowedOrigins: [],
      localTestAllowedOrigins: ['https://target.example'],
      requireSignedReceipt: true,
    });
    expect(policy.receiptKey).toBeUndefined();
  });

  it('reads the independent allowlist and receipt key only from operator environment', () => {
    expect(
      operatorAttestationSettings({
        ARXIC_ATTESTATION_ALLOWED_ORIGINS:
          'https://preview-one.example, https://preview-two.example',
        ARXIC_ATTESTATION_RECEIPT_KEY: 'operator-secret',
      }),
    ).toEqual({
      operatorAllowedOrigins: ['https://preview-one.example', 'https://preview-two.example'],
      receiptKey: 'operator-secret',
    });
  });
});
