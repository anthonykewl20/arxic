'use server';

import bcrypt from 'bcryptjs';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { findUserByEmail } from '../../lib/db';
import { consumeRateLimit } from '../../lib/rateLimit';
import { createMfaChallenge, createSession, destroySession } from '../../lib/session';
import { verifyCsrf } from '../../lib/csrf';

export async function login(formData: FormData): Promise<never> {
  if (!(await verifyCsrf(formData))) redirect('/login?error=Invalid%20request');
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const user = findUserByEmail(email);
  const forwardedFor = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  // #297 E2: the per-email bucket is 10/min (default is 5) — an
  // authenticated breadth-discovery run legitimately adds one crawl-tier
  // login per run on top of the per-pass verifier logins, and the #288
  // two-run E2E shape (2 crawls + 4 passes) sits at 6. The limit itself
  // stays (brute-force realism); no test pins the numeric value.
  const permitted =
    consumeRateLimit(`login-email:${email || 'unknown'}`, 10) &&
    consumeRateLimit(`login-ip:${forwardedFor}`, 20);
  const valid = Boolean(permitted && user && !user.locked && (await bcrypt.compare(password, user.passwordHash)));
  if (!valid) redirect('/login?error=Invalid%20credentials');
  if (user?.mfaSecret) {
    await destroySession();
    await createMfaChallenge(email);
    redirect('/mfa/challenge');
  }
  await createSession(email);
  redirect('/');
}
