import { randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

export const CSRF_COOKIE = 'arxic_csrf';

export function newCsrfToken(): string {
  return randomBytes(24).toString('base64url');
}

export async function currentCsrfToken(): Promise<string> {
  const store = await cookies();
  return store.get(CSRF_COOKIE)?.value ?? '';
}

export async function verifyCsrf(formData: FormData): Promise<boolean> {
  const store = await cookies();
  const cookieToken = store.get(CSRF_COOKIE)?.value ?? '';
  const formToken = String(formData.get('csrfToken') ?? '');
  if (!cookieToken || !formToken) return false;
  const expected = Buffer.from(cookieToken);
  const supplied = Buffer.from(formToken);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
