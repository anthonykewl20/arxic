import { currentCsrfToken } from '../../lib/csrf';
import { login } from './actions';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const [{ error, message }, csrfToken] = await Promise.all([searchParams, currentCsrfToken()]);
  return (
    <main>
      <h1>Login</h1>
      {message ? <p className="message">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <form action={login}>
        <input type="hidden" name="csrfToken" value={csrfToken} />
        <label>Email<input name="email" type="email" required /></label>
        <label>Password<input name="password" type="password" required /></label>
        <button type="submit">Login</button>
      </form>
    </main>
  );
}
