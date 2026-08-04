import { NextResponse, type NextRequest } from 'next/server';

const protectedPaths = ['/change-password', '/logout'];
const csrfCookie = 'arxic_csrf';
const sessionSecret = process.env.ARXIC_SESSION_SECRET || 'arxic-reference-fixture-secret';

async function hasSignedSession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get('arxic_session')?.value;
  const [id, encodedEmail, encodedSignature, extra] = token?.split('.') ?? [];
  if (!id || !encodedEmail || !encodedSignature || extra) return false;
  try {
    const payload = `${id}.${encodedEmail}`;
    const signature = encodedSignature.replaceAll('-', '+').replaceAll('_', '/');
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(sessionSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify(
      'HMAC',
      key,
      Uint8Array.from(atob(signature), (character) => character.charCodeAt(0)),
      new TextEncoder().encode(payload),
    );
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  if (
    protectedPaths.some((path) => request.nextUrl.pathname.startsWith(path)) &&
    !(await hasSignedSession(request))
  ) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const response = NextResponse.next();
  if (!request.cookies.get(csrfCookie)) {
    response.cookies.set(csrfCookie, crypto.randomUUID(), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
