import { describe, expect, test } from 'vitest';
import { authenticator } from 'otplib';
import { ARXIC_FIXTURE_SECRET_LEAK, OtpAdapter } from './index';

describe('OtpAdapter', () => {
  test('blocks an invalid supplied secret without retaining it', async () => {
    const adapter = new OtpAdapter();
    await expect(
      adapter.provision({ kind: 'otp', parameters: { secret: 'raw-invalid-secret' } }),
    ).rejects.toMatchObject({ code: ARXIC_FIXTURE_SECRET_LEAK });
  });

  test('uses real otplib while keeping the secret opaque in the lease', async () => {
    const adapter = new OtpAdapter();
    const secret = authenticator.generateSecret();
    const lease = await adapter.provision({ kind: 'otp', parameters: { secret, digits: 6 } });
    const serialized = JSON.stringify(lease);
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain('[REDACTED]');
    const token = adapter.generate(lease);
    expect(token).toMatch(/^\d{6}$/u);
    expect(adapter.validate(lease, token)).toBe(true);
    await adapter.reset(lease);
    await adapter.release(lease);
    expect(() => adapter.generate(lease)).toThrow('released');
  });
});
