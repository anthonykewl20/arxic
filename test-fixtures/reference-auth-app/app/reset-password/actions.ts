'use server';

import bcrypt from 'bcryptjs';
import { redirect } from 'next/navigation';
import { db } from '../../lib/db';
import { verifyCsrf } from '../../lib/csrf';

export async function resetPassword(formData: FormData): Promise<never> {
  if (!(await verifyCsrf(formData))) redirect('/reset-password?error=Invalid%20request');
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  if (password.length < 8) redirect(`/reset-password?token=${encodeURIComponent(token)}&error=Password%20must%20be%20at%20least%208%20characters`);
  const row = db.prepare('SELECT email, expiresAt FROM reset_tokens WHERE token = ?').get(token) as
    | { email: string; expiresAt: number }
    | undefined;
  if (!row || row.expiresAt <= Date.now()) {
    if (row) db.prepare('DELETE FROM reset_tokens WHERE token = ?').run(token);
    redirect('/reset-password?error=Invalid%20or%20expired%20reset%20token');
  }
  const passwordHash = await bcrypt.hash(password, 12);
  db.transaction(() => {
    db.prepare('UPDATE users SET passwordHash = ?, failedAttempts = 0, locked = 0 WHERE email = ?').run(passwordHash, row.email);
    db.prepare('DELETE FROM reset_tokens WHERE token = ?').run(token);
    db.prepare('DELETE FROM sessions WHERE email = ?').run(row.email);
  })();
  redirect('/login?message=Password%20reset%20successfully');
}
