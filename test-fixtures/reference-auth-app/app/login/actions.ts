'use server';

import bcrypt from 'bcryptjs';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { findUserByEmail } from '../../lib/db';
import { consumeRateLimit } from '../../lib/rateLimit';
import { createSession } from '../../lib/session';
import { verifyCsrf } from '../../lib/csrf';

export async function login(formData: FormData): Promise<never> {
  if (!(await verifyCsrf(formData))) redirect('/login?error=Invalid%20request');
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const user = findUserByEmail(email);
  const forwardedFor = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const permitted =
    consumeRateLimit(`login-email:${email || 'unknown'}`) &&
    consumeRateLimit(`login-ip:${forwardedFor}`, 20);
  const valid = Boolean(permitted && user && !user.locked && (await bcrypt.compare(password, user.passwordHash)));
  if (!valid) redirect('/login?error=Invalid%20credentials');
  await createSession(email);
  redirect('/');
}
