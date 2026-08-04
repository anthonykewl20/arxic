'use server';

import bcrypt from 'bcryptjs';
import { redirect } from 'next/navigation';
import { db, findUserByEmail } from '../../lib/db';
import { readCurrentSession } from '../../lib/session';
import { verifyCsrf } from '../../lib/csrf';

export async function changePassword(formData: FormData): Promise<never> {
  if (!(await verifyCsrf(formData))) redirect('/change-password?error=Invalid%20request');
  const email = await readCurrentSession();
  if (!email) redirect('/login');
  const currentPassword = String(formData.get('currentPassword') ?? '');
  const newPassword = String(formData.get('newPassword') ?? '');
  const user = findUserByEmail(email);
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    redirect('/change-password?error=Current%20password%20is%20incorrect');
  }
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    redirect('/change-password?error=New%20password%20must%20be%20different');
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  db.prepare('UPDATE users SET passwordHash = ? WHERE email = ?').run(passwordHash, email);
  redirect('/change-password?message=Password%20changed%20successfully');
}
