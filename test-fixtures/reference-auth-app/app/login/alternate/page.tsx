import { currentCsrfToken } from '../../../lib/csrf';
import { login } from '../actions';

// WEB-402-PERSONA-VARIANTS-1D: a real SECOND authentication entry point with
// its own form labels, so persona variants can exercise a distinct login path.
export default async function AlternateLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const [{ error, message }, csrfToken] = await Promise.all([searchParams, currentCsrfToken()]);
  return (
    <main>
      <h1>Login</h1>
      <p data-testid="alternate-login">alternate</p>
      {message ? <p className="message">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <form action={login}>
        <input type="hidden" name="csrfToken" value={csrfToken} />
        <label>Work email<input name="email" type="email" required /></label>
        <label>Passphrase<input name="password" type="password" required /></label>
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
