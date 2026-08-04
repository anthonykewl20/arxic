import { currentCsrfToken } from '../../lib/csrf';
import { requestPasswordReset } from './actions';

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  const [params, csrfToken] = await Promise.all([searchParams, currentCsrfToken()]);
  return (
    <main>
      <h1>Forgot password</h1>
      {params.message ? <p className="message">{params.message}</p> : null}
      {params.error ? <p className="error">{params.error}</p> : null}
      <form action={requestPasswordReset}>
        <input type="hidden" name="csrfToken" value={csrfToken} />
        <label>Email<input name="email" type="email" required /></label>
        <button type="submit">Send reset email</button>
      </form>
    </main>
  );
}
