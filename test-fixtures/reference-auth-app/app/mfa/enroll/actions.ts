'use server';

import { authenticator } from 'otplib';
import { redirect } from 'next/navigation';
import { db, findUserByEmail } from '../../../lib/db';
import { readCurrentSession } from '../../../lib/session';
import { verifyCsrf } from '../../../lib/csrf';

export async function beginEnrollment(formData: FormData): Promise<never> {
  if (!(await verifyCsrf(formData))) redirect('/mfa/enroll?error=Invalid%20request');
  const email = await readCurrentSession();
  if (!email) redirect('/login');
  const secret = authenticator.generateSecret();
  db.prepare('UPDATE users SET mfaSecret = ? WHERE email = ?').run(secret, email);
  redirect('/mfa/enroll?message=MFA%20secret%20generated');
}

export async function confirmEnrollment(formData: FormData): Promise<never> {
  if (!(await verifyCsrf(formData))) redirect('/mfa/enroll?error=Invalid%20request');
  const email = await readCurrentSession();
  if (!email) redirect('/login');
  const user = findUserByEmail(email);
  const token = String(formData.get('token') ?? '');
  if (!user?.mfaSecret || !authenticator.verify({ token, secret: user.mfaSecret })) {
    redirect('/mfa/enroll?error=Invalid%20authentication%20code');
  }
  redirect('/mfa/enroll?message=MFA%20enrollment%20confirmed');
}
