import { NextResponse } from 'next/server';
import { destroySession } from '../../lib/session';

export async function POST(request: Request): Promise<NextResponse> {
  await destroySession();
  return NextResponse.redirect(new URL('/', request.url), 303);
}
