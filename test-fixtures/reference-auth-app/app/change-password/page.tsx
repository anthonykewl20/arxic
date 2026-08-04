import { currentCsrfToken } from '../../lib/csrf';
import { changePassword } from './actions';

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const [{ error, message }, csrfToken] = await Promise.all([searchParams, currentCsrfToken()]);
  return (
    <main>
      <h1>Change password</h1>
      {message ? <p className="message">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <form action={changePassword}>
        <input type="hidden" name="csrfToken" value={csrfToken} />
        <label>Current password<input name="currentPassword" type="password" required /></label>
        <label>New password<input name="newPassword" type="password" required /></label>
        <button type="submit">Change password</button>
      </form>
    </main>
  );
}
