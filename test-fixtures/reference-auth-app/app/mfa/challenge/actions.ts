'use server';

import { authenticator } from 'otplib';
import { redirect } from 'next/navigation';
import { findUserByEmail } from '../../../lib/db';
import { completeMfaChallenge, readMfaChallenge } from '../../../lib/session';
import { verifyCsrf } from '../../../lib/csrf';

export async function challengeMfa(formData: FormData): Promise<never> {
  if (!(await verifyCsrf(formData))) redirect('/mfa/challenge?error=Invalid%20request');
  const email = await readMfaChallenge();
  if (!email) redirect('/login?error=MFA%20challenge%20expired');
  const user = findUserByEmail(email);
  const token = String(formData.get('token') ?? '');
  if (!user?.mfaSecret || !authenticator.verify({ token, secret: user.mfaSecret })) {
    redirect('/mfa/challenge?error=Invalid%20authentication%20code');
  }
  if (!(await completeMfaChallenge())) redirect('/login?error=MFA%20challenge%20expired');
  redirect('/');
}
