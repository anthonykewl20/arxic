import { clearRateLimits } from '../../../../lib/rateLimit';
import { resetFixtureDatabase } from '../../../../lib/db';

export async function POST(): Promise<Response> {
  resetFixtureDatabase();
  clearRateLimits();
  return new Response(null, { status: 204 });
}
