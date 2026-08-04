import { authenticator } from 'otplib';
import { currentCsrfToken } from '../../../lib/csrf';
import { findUserByEmail } from '../../../lib/db';
import { readCurrentSession } from '../../../lib/session';
import { beginEnrollment, confirmEnrollment } from './actions';

export default async function MfaEnrollPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const [{ error, message }, csrfToken, email] = await Promise.all([
    searchParams,
    currentCsrfToken(),
    readCurrentSession(),
  ]);
  const secret = email ? findUserByEmail(email)?.mfaSecret : null;
  const otpauthUri = secret && email ? authenticator.keyuri(email, 'Arxic Reference Auth App', secret) : null;
  return (
    <main>
      <h1>Enroll MFA</h1>
      {message ? <p className="message">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <form action={beginEnrollment}>
        <input type="hidden" name="csrfToken" value={csrfToken} />
        <button type="submit">Generate secret</button>
      </form>
      {secret ? (
        <section>
          <p>Secret: <code>{secret}</code></p>
          <p>OTPAuth URI: <code>{otpauthUri}</code></p>
          <form action={confirmEnrollment}>
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <label>Authentication code<input name="token" inputMode="numeric" required /></label>
            <button type="submit">Confirm MFA</button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
