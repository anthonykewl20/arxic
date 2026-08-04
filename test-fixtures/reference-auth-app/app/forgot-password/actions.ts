'use server';

import { randomBytes, randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { db, findUserByEmail } from '../../lib/db';
import { sendResetEmail } from '../../lib/mail';
import { verifyCsrf } from '../../lib/csrf';

const accepted = '/forgot-password?message=If%20that%20account%20exists%2C%20a%20reset%20email%20has%20been%20sent.';

export async function requestPasswordReset(formData: FormData): Promise<never> {
  if (!(await verifyCsrf(formData))) redirect('/forgot-password?error=Invalid%20request');
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const user = findUserByEmail(email);
  if (user) {
    const token = randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM reset_tokens WHERE email = ?').run(email);
    db.prepare('INSERT INTO reset_tokens (id, email, token, expiresAt) VALUES (?, ?, ?, ?)').run(
      randomUUID(), email, token, Date.now() + 15 * 60_000,
    );
    const origin = process.env.ARXIC_TARGET_ORIGIN || 'http://localhost:3002';
    await sendResetEmail(email, `${origin}/reset-password?token=${encodeURIComponent(token)}`);
  }
  redirect(accepted);
}
