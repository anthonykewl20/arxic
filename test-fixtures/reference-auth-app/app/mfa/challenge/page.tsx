import { currentCsrfToken } from '../../../lib/csrf';
import { challengeMfa } from './actions';

export default async function MfaChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ error }, csrfToken] = await Promise.all([searchParams, currentCsrfToken()]);
  return (
    <main>
      <h1>MFA challenge</h1>
      {error ? <p className="error">{error}</p> : null}
      <form action={challengeMfa}>
        <input type="hidden" name="csrfToken" value={csrfToken} />
        <label>Authentication code<input name="token" inputMode="numeric" required /></label>
        <button type="submit">Verify</button>
      </form>
    </main>
  );
}
