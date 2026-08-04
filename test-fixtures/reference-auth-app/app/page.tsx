import Link from 'next/link';
import { readCurrentSession } from '../lib/session';

export default async function HomePage() {
  const email = await readCurrentSession();
  return (
    <main>
      <h1>Reference Auth App</h1>
      <p data-testid="session-state">{email ? `Logged in as ${email}` : 'Logged out'}</p>
      <nav>
        <Link href="/login">Login</Link>
        <Link href="/forgot-password">Forgot password</Link>
        <Link href="/change-password">Change password</Link>
      </nav>
      {email ? (
        <form action="/logout" method="post">
          <button type="submit">Logout</button>
        </form>
      ) : null}
    </main>
  );
}
