import { currentCsrfToken } from '../../lib/csrf';
import { resetPassword } from './actions';

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const [params, csrfToken] = await Promise.all([searchParams, currentCsrfToken()]);
  return (
    <main>
      <h1>Reset password</h1>
      {params.error ? <p className="error">{params.error}</p> : null}
      <form action={resetPassword}>
        <input type="hidden" name="csrfToken" value={csrfToken} />
        <input type="hidden" name="token" value={params.token ?? ''} />
        <label>New password<input name="password" type="password" minLength={8} required /></label>
        <button type="submit">Reset password</button>
      </form>
    </main>
  );
}
