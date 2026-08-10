import { describe, expect, test } from 'vitest';
import { authenticator } from 'otplib';

const baseUrl = process.env.ARXIC_TEST_BASE_URL || 'http://localhost:4012';
const mailpitApi = process.env.ARXIC_MAILPIT_API || 'http://localhost:8025';

interface BrowserState { cookies: Map<string, string> }

function captureCookies(state: BrowserState, response: Response): void {
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';', 1)[0];
    const separator = pair.indexOf('=');
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (value) state.cookies.set(name, value); else state.cookies.delete(name);
  }
}

async function browserFetch(state: BrowserState, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (state.cookies.size) headers.set('cookie', [...state.cookies].map(([key, value]) => `${key}=${value}`).join('; '));
  if (init.method && init.method !== 'GET') headers.set('origin', baseUrl);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers, redirect: 'manual' });
  captureCookies(state, response);
  return response;
}

function hiddenFields(html: string): URLSearchParams {
  const values = new URLSearchParams();
  const pattern = /<input[^>]+type="hidden"[^>]+>/g;
  for (const input of html.match(pattern) ?? []) {
    const name = input.match(/name="([^"]+)"/)?.[1];
    const value = input.match(/value="([^"]*)"/)?.[1] ?? '';
    if (name) values.set(name, value.replaceAll('&amp;', '&'));
  }
  return values;
}

async function submitServerAction(state: BrowserState, path: string, fields: Record<string, string>): Promise<Response> {
  const page = await browserFetch(state, path);
  expect(page.status).toBe(200);
  const form = hiddenFields(await page.text());
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const body = new FormData();
  form.forEach((value, key) => body.set(key, value));
  return browserFetch(state, path, {
    method: 'POST',
    body,
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
      const text = collectStrings(await message.json()).join('\n');
      const token = text.match(/[?&]token=([A-Za-z0-9_-]+)/)?.[1];
      if (token) {
        console.log(`[real-mailpit] reset email found for user@example.test; token present (${token.length} chars)`);
        return token;
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error('Mailpit did not receive a reset email containing a token within 10 seconds');
}

describe('real reference auth app', () => {
  test('executes Next image optimization through safe sharp', async () => {
    const imagePath = `/api/__arxic/image/${crypto.randomUUID()}`;
    const source = await fetch(`${baseUrl}${imagePath}`);
    expect(source.status).toBe(200);
    const sourceBytes = await source.arrayBuffer();
    expect(new DataView(sourceBytes).getUint32(16)).toBe(64);

    const optimized = await fetch(
      `${baseUrl}/_next/image?url=${encodeURIComponent(imagePath)}&w=32&q=75`,
      { headers: { accept: 'image/png' } },
    );
    expect(optimized.status).toBe(200);
    expect(optimized.headers.get('content-type')).toBe('image/png');
    expect(optimized.headers.get('x-nextjs-cache')).toBe('MISS');
    const optimizedBytes = await optimized.arrayBuffer();
    expect(new DataView(optimizedBytes).getUint32(16)).toBe(32);
    expect(optimizedBytes.byteLength).not.toBe(sourceBytes.byteLength);
  });

  test('keeps the Phase 1 login, reset email, password reset, attestation, and logout flow green', async () => {
    const state: BrowserState = { cookies: new Map() };
    const forgedSession: BrowserState = { cookies: new Map([['arxic_session', 'malformed.!']]) };
    const protectedRoute = await browserFetch(forgedSession, '/logout');
    expect(protectedRoute.status).toBe(307);
    expect(protectedRoute.headers.get('location')).toBe('/login');

    const clearInbox = await fetch(`${mailpitApi}/api/v1/messages`, { method: 'DELETE' });
    expect(clearInbox.ok).toBe(true);
    const reset = await browserFetch(state, '/__arxic/reset', { method: 'POST' });
    expect(reset.status).toBe(204);

    const seed = await browserFetch(state, '/__arxic/seed', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personaId: 'u1', email: 'user@example.test', password: 'Hunter2!' }),
    });
    expect(seed.status).toBe(201);

    const login = await submitServerAction(state, '/login', { email: 'user@example.test', password: 'Hunter2!' });
    expect(login.status).toBe(303);
    expect(login.headers.get('location')).toBe('/');
    expect(state.cookies.has('arxic_session')).toBe(true);

    const wrong = await submitServerAction({ cookies: new Map() }, '/login', { email: 'user@example.test', password: 'wrong-password' });
    expect(wrong.status).toBe(303);
    const wrongLocation = wrong.headers.get('location');
    expect(wrongLocation).toContain('Invalid%20credentials');
    const renderedError = await fetch(`${baseUrl}${wrongLocation}`);
    expect(await renderedError.text()).toContain('Invalid credentials');

    const forgot = await submitServerAction(state, '/forgot-password', { email: 'user@example.test' });
    expect(forgot.status).toBe(303);
    const accepted = await browserFetch(state, forgot.headers.get('location') ?? '/forgot-password');
    expect(await accepted.text()).toContain('If that account exists, a reset email has been sent.');
    const token = await findResetToken();

    const passwordReset = await submitServerAction(state, `/reset-password?token=${token}`, { token, password: 'NewHunter3!' });
    expect(passwordReset.status).toBe(303);
    expect(passwordReset.headers.get('location')).toContain('Password%20reset%20successfully');

    state.cookies.clear();
    const reauthenticated = await submitServerAction(state, '/login', {
      email: 'user@example.test',
      password: 'NewHunter3!',
    });
    expect(reauthenticated.headers.get('location')).toBe('/');
    const changePassword = await submitServerAction(state, '/change-password', {
      currentPassword: 'NewHunter3!',
      newPassword: 'Changed4!',
    });
    expect(changePassword.status).toBe(303);
    expect(changePassword.headers.get('location')).toContain('Password%20changed%20successfully');
    console.log('[reference-flow] authenticated change-password succeeded');

    const attestation = await browserFetch(state, '/.well-known/arxic-test-target.json');
    expect(attestation.headers.get('content-type')).toContain('application/json');
    const target = await attestation.json() as Record<string, unknown>;
    expect(target.environmentClass).toBe('local-test');
    expect(target.origin).toBe(baseUrl);
    expect(target.allowedOrigins).toEqual([baseUrl]);
    expect(target.buildDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(target.nonce).toBeTruthy();

    const logout = await browserFetch(state, '/logout', { method: 'POST' });
    expect(logout.status).toBe(303);
    expect(state.cookies.has('arxic_session')).toBe(false);

    const oldPassword = await submitServerAction({ cookies: new Map() }, '/login', {
      email: 'user@example.test',
      password: 'NewHunter3!',
    });
    expect(oldPassword.headers.get('location')).toContain('Invalid%20credentials');
    const newPasswordState: BrowserState = { cookies: new Map() };
    const newPassword = await submitServerAction(newPasswordState, '/login', {
      email: 'user@example.test',
      password: 'Changed4!',
    });
    expect(newPassword.headers.get('location')).toBe('/');
    expect(newPasswordState.cookies.has('arxic_session')).toBe(true);
    console.log('[reference-flow] old password rejected and changed password accepted');

    expect((await browserFetch(state, '/__arxic/reset', { method: 'POST' })).status).toBe(204);
    expect(
      (
        await browserFetch(state, '/__arxic/seed', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            personaId: 'u1',
            email: 'user@example.test',
            password: 'Hunter2!',
          }),
        })
      ).status,
    ).toBe(201);
    const cleanRun = await submitServerAction({ cookies: new Map() }, '/login', {
      email: 'user@example.test',
      password: 'Hunter2!',
    });
    expect(cleanRun.headers.get('location')).toBe('/');
  });

  test('requires a real TOTP challenge before creating a full session', async () => {
    const state: BrowserState = { cookies: new Map() };
    expect((await browserFetch(state, '/__arxic/reset', { method: 'POST' })).status).toBe(204);
    const secret = authenticator.generateSecret();
    const seed = await browserFetch(state, '/__arxic/seed', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        personaId: 'mfa-user',
        email: 'mfa@example.test',
        password: 'MfaHunter2!',
        mfaSecret: secret,
      }),
    });
    expect(seed.status).toBe(201);

    const login = await submitServerAction(state, '/login', {
      email: 'mfa@example.test',
      password: 'MfaHunter2!',
    });
    expect(login.status).toBe(303);
    expect(login.headers.get('location')).toBe('/mfa/challenge');
    expect(state.cookies.has('arxic_mfa_pending')).toBe(true);
    expect(state.cookies.has('arxic_session')).toBe(false);

    const challenge = await submitServerAction(state, '/mfa/challenge', {
      token: authenticator.generate(secret),
    });
    expect(challenge.status).toBe(303);
    expect(challenge.headers.get('location')).toBe('/');
    expect(state.cookies.has('arxic_mfa_pending')).toBe(false);
    expect(state.cookies.has('arxic_session')).toBe(true);
    const home = await browserFetch(state, '/');
    expect(await home.text()).toContain('Logged in as mfa@example.test');
    console.log('[reference-flow] password login stopped at MFA challenge; real otplib TOTP created full session');
  });
});
