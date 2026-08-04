import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { db } from './db';

export const SESSION_COOKIE = 'arxic_session';
export const MFA_PENDING_COOKIE = 'arxic_mfa_pending';
const secret = process.env.ARXIC_SESSION_SECRET || 'arxic-reference-fixture-secret';

function sign(value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function unpack(token: string | undefined): { id: string; email: string } | null {
  if (!token) return null;
  const [id, encodedEmail, encodedSignature, extra] = token.split('.');
  if (!id || !encodedEmail || !encodedSignature || extra) return null;
  const payload = `${id}.${encodedEmail}`;
  const supplied = Buffer.from(encodedSignature);
  const expected = Buffer.from(sign(payload));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  return { id, email: Buffer.from(encodedEmail, 'base64url').toString('utf8') };
}

export async function createSession(email: string): Promise<void> {
  const id = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (id, email, createdAt) VALUES (?, ?, ?)').run(
    id,
    email,
    Date.now(),
  );
  const store = await cookies();
  const payload = `${id}.${Buffer.from(email).toString('base64url')}`;
  store.set(SESSION_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.ARXIC_COOKIE_SECURE === '1',
    path: '/',
  });
}

export async function createMfaChallenge(email: string): Promise<void> {
  const id = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO mfa_challenges (id, email, createdAt) VALUES (?, ?, ?)').run(
    id,
    email,
    Date.now(),
  );
  const store = await cookies();
  const payload = `${id}.${Buffer.from(email).toString('base64url')}`;
  store.set(MFA_PENDING_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.ARXIC_COOKIE_SECURE === '1',
    path: '/',
    maxAge: 5 * 60,
  });
}

export async function readMfaChallenge(): Promise<string | null> {
  const store = await cookies();
  const challenge = unpack(store.get(MFA_PENDING_COOKIE)?.value);
  if (!challenge) return null;
  const row = db.prepare('SELECT email, createdAt FROM mfa_challenges WHERE id = ?').get(challenge.id) as
    | { email: string; createdAt: number }
    | undefined;
  if (!row || row.email !== challenge.email || row.createdAt + 5 * 60_000 <= Date.now()) return null;
  return row.email;
}

export async function completeMfaChallenge(): Promise<string | null> {
  const email = await readMfaChallenge();
  if (!email) return null;
  const store = await cookies();
  const challenge = unpack(store.get(MFA_PENDING_COOKIE)?.value);
  if (challenge) db.prepare('DELETE FROM mfa_challenges WHERE id = ?').run(challenge.id);
  store.set(MFA_PENDING_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  await createSession(email);
  return email;
}

export async function readCurrentSession(): Promise<string | null> {
  const store = await cookies();
  return readSessionToken(store.get(SESSION_COOKIE)?.value);
}

export function readSession(request: NextRequest): string | null {
  return readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
}

function readSessionToken(token: string | undefined): string | null {
  const session = unpack(token);
  if (!session) return null;
  const row = db.prepare('SELECT email FROM sessions WHERE id = ?').get(session.id) as
    | { email: string }
    | undefined;
  return row?.email === session.email ? row.email : null;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const session = unpack(store.get(SESSION_COOKIE)?.value);
  if (session) db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
  store.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
}
