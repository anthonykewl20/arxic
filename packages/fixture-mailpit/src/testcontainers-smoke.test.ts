import { MailpitContainer } from '@arxic/environment';
import { describe, expect, test } from 'vitest';

describe('Testcontainers 12 Mailpit startup', () => {
  test('starts a real Mailpit container on random mapped ports without configured endpoints', async () => {
    expect(process.env.ARXIC_MAILPIT_SMTP).toBeUndefined();
    expect(process.env.ARXIC_MAILPIT_API).toBeUndefined();

    const mailpit = await new MailpitContainer().start();
    try {
      const smtp = new URL(`smtp://${mailpit.smtp}`);
      const api = new URL(mailpit.api);
      expect(Number(smtp.port)).toBeGreaterThan(0);
      expect(Number(smtp.port)).not.toBe(1025);
      expect(Number(api.port)).toBeGreaterThan(0);
      expect(Number(api.port)).not.toBe(8025);

      const response = await fetch(new URL('/api/v1/info', api));
      expect(response.status).toBe(200);
    } finally {
      await mailpit.stop();
    }
  }, 60_000);
});
