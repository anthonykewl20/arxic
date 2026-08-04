import { describe, expect, test } from 'vitest';

const baseUrl = process.env.ARXIC_TEST_BASE_URL || 'http://localhost:4011';
const mailpitApi = process.env.ARXIC_MAILPIT_API || 'http://localhost:8025';

async function formPost(path: string, fields: Record<string, string>): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    redirect: 'manual',
  });
}

function collectStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, output));
  return output;
}

async function findResetToken(): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const search = await fetch(`${mailpitApi}/api/v1/search?query=${encodeURIComponent('to:user@example.test')}`);
    expect(search.ok).toBe(true);
    const result: unknown = await search.json();
    const records = result && typeof result === 'object' && 'messages' in result && Array.isArray(result.messages) ? result.messages : [];
    for (const record of records) {
      if (!record || typeof record !== 'object' || !('ID' in record) || typeof record.ID !== 'string') continue;
      const message = await fetch(`${mailpitApi}/api/v1/message/${record.ID}`);
      const token = collectStrings(await message.json()).join('\n').match(/[?&]token=([A-Za-z0-9_-]+)/)?.[1];
      if (token) {
        console.log(`[real-mailpit] vulnerable reset email found; token present (${token.length} chars)`);
        return token;
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error('Mailpit did not receive the vulnerable-app reset email within 10 seconds');
}

describe('real vulnerable auth app', () => {
  test('proves enumeration and reusable reset-token weaknesses against real Mailpit', async () => {
    expect((await fetch(`${mailpitApi}/api/v1/messages`, { method: 'DELETE' })).ok).toBe(true);
    expect((await fetch(`${baseUrl}/__arxic/reset`, { method: 'POST' })).status).toBe(204);
    const seed = await fetch(`${baseUrl}/__arxic/seed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personaId: 'u1', email: 'user@example.test', password: 'Hunter2!' }),
    });
    expect(seed.status).toBe(201);

    const login = await formPost('/login', { email: 'user@example.test', password: 'Hunter2!' });
    expect(login.status).toBe(302);
    expect(login.headers.get('location')).toContain('/?message=Logged%20in');
    expect(login.headers.get('set-cookie')).toContain('session=user%40example.test');

    const missing = await formPost('/login', { email: 'missing@example.test', password: 'wrong' });
    const wrong = await formPost('/login', { email: 'user@example.test', password: 'wrong' });
    const missingMessage = await missing.text();
    const wrongMessage = await wrong.text();
    expect(missingMessage).toContain('No account with that email');
    expect(wrongMessage).toContain('Incorrect password for that account');
    expect(missingMessage).not.toBe(wrongMessage);
    console.log('[weakness-proven] account enumeration returns distinct unknown-email and wrong-password messages');

    const forgot = await formPost('/forgot', { email: 'user@example.test' });
    expect(await forgot.text()).toContain('A reset link has been sent to that account');
    const token = await findResetToken();
    const firstReset = await formPost('/reset', { token, password: 'Changed3!' });
    expect(await firstReset.text()).toContain('Password reset successfully');
    const reusedReset = await formPost('/reset', { token, password: 'Changed4!' });
    expect(await reusedReset.text()).toContain('Password reset successfully');
    console.log('[weakness-proven] the same reset token succeeded twice');

    const attestation = await fetch(`${baseUrl}/.well-known/arxic-test-target.json`);
    const target = await attestation.json() as Record<string, unknown>;
    expect(target.environmentClass).toBe('local-test');
    expect(target.origin).toBe(baseUrl);
    expect(target.allowedOrigins).toEqual([baseUrl]);
    expect(target.buildDigest).toMatch(/^[a-f0-9]{64}$/);
  });
});
