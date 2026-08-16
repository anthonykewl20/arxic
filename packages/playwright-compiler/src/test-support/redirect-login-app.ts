// DG-09 test-support REAL web application, migrated from the DG-03 spike's
// redirect-login-app (extracted into the productionized packages; the spike
// stays as read-only evidence). It carries the #257/#258 defect classes the
// two fixture apps cannot: post-login redirect 302 → /dashboard (NOT '/'; see
// reference-auth-app app/login/actions.ts:28 and vulnerable-auth-app
// src/server.ts:47, which both redirect to '/'). It additionally hosts a
// GENERIC NON-AUTH form flow (newsletter subscribe) so the generic form-flow
// executor is proven domain-general, not auth-shaped. Real engines only:
// node:http, node:sqlite (DatabaseSync), node:crypto (scrypt, HMAC). Zero
// external dependencies. This module is TEST SUPPORT surface for the
// compiler/verifier real-world suites, not product code.
//
// Surface:
//   GET  /login                    — labelled login form (Email/Password, "Log in")
//   POST /login                    — scrypt verify → session cookie → 302 /dashboard
//   GET  /dashboard                — requires session; <h1>Dashboard</h1>; else 302 /login
//   GET  /newsletter               — generic form (Email, "Subscribe"); no auth required
//   POST /newsletter/subscribe     — persists subscriber → 302 /newsletter/thanks
//   GET  /newsletter/thanks        — <h1>Subscribed</h1> (+ subscriber count)
//   POST /__arxic/seed | /__arxic/reset — fixture control (same contract as the fixture apps)
//   GET  /.well-known/arxic-test-target.json — target attestation
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { sha256 } from '@arxic/contracts';

export const REDIRECT_APP_BUILD = 'dg09-redirect-login-app@0.1.1' as const;
export const REDIRECT_APP_NONCE = 'dg09-redirect-login-app-v1' as const;

export type RedirectLoginAppOptions = Readonly<{
  port: number;
  dbPath: string;
  origin: string;
}>;

const MAX_BODY_BYTES = 1_000_000;
const SESSION_COOKIE = 'dg09_session';

function scryptHash(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32);
}

function verifyPassword(password: string, saltHex: string, expectedHashHex: string): boolean {
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(expectedHashHex, 'hex');
  const actual = scryptHash(password, salt);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parseUrlencoded(body: Buffer): URLSearchParams {
  return new URLSearchParams(body.toString('utf8'));
}

function page(title: string, main: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
<main>
  ${main}
</main>
</body>
</html>`;
}

function loginPage(): string {
  return page(
    'Log in',
    `<h1>Log in</h1>
  <form method="post" action="/login">
    <label>Email<input name="email" type="email" autocomplete="username" required></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
    <button type="submit">Log in</button>
  </form>`,
  );
}

function dashboardPage(): string {
  return page(
    'Dashboard',
    `<h1>Dashboard</h1>
  <p>Welcome back. Orders sync automatically.</p>`,
  );
}

function newsletterPage(): string {
  return page(
    'Newsletter',
    `<h1>Newsletter</h1>
  <form method="post" action="/newsletter/subscribe">
    <label>Email<input name="email" type="email" autocomplete="email" required></label>
    <button type="submit">Subscribe</button>
  </form>`,
  );
}

function thanksPage(count: number): string {
  return page(
    'Subscribed',
    `<h1>Subscribed</h1>
  <p>You are subscriber number ${count}.</p>`,
  );
}

export function createRedirectLoginApp(options: RedirectLoginAppOptions): {
  server: Server;
} {
  const db = new DatabaseSync(options.dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      salt TEXT NOT NULL,
      passwordHash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subscribers (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      createdAt INTEGER NOT NULL
    );
  `);

  const sessionEmail = (request: IncomingMessage): string | undefined => {
    const cookie = request.headers.cookie ?? '';
    const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
    if (!match) return undefined;
    const row = db.prepare('SELECT email FROM sessions WHERE token = ?').get(match[1]!) as
      { email: string } | undefined;
    return row?.email;
  };

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'internal error' }));
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', options.origin);

    if (request.method === 'GET' && url.pathname === '/.well-known/arxic-test-target.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          environmentClass: 'local-test',
          origin: options.origin,
          allowedOrigins: [options.origin],
          buildDigest: sha256(REDIRECT_APP_BUILD),
          nonce: REDIRECT_APP_NONCE,
        }),
      );
      return;
    }

    if (request.method === 'POST' && url.pathname === '/__arxic/reset') {
      db.exec('DELETE FROM sessions; DELETE FROM subscribers; DELETE FROM users;');
      response.writeHead(204).end();
      return;
    }

    if (request.method === 'POST' && url.pathname === '/__arxic/seed') {
      const body = JSON.parse((await readBody(request)).toString('utf8')) as {
        personaId?: string;
        email?: string;
        password?: string;
      };
      if (
        typeof body.personaId !== 'string' ||
        typeof body.email !== 'string' ||
        typeof body.password !== 'string'
      ) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: false, error: 'Invalid seed payload' }));
        return;
      }
      const salt = randomBytes(16);
      const hash = scryptHash(body.password, salt);
      db.prepare(
        `INSERT INTO users (id, email, salt, passwordHash) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET email = excluded.email, salt = excluded.salt, passwordHash = excluded.passwordHash`,
      ).run(
        body.personaId,
        body.email.trim().toLowerCase(),
        salt.toString('hex'),
        hash.toString('hex'),
      );
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/login') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(loginPage());
      return;
    }

    if (request.method === 'POST' && url.pathname === '/login') {
      const form = parseUrlencoded(await readBody(request));
      const email = (form.get('email') ?? '').trim().toLowerCase();
      const password = form.get('password') ?? '';
      const user = db.prepare('SELECT salt, passwordHash FROM users WHERE email = ?').get(email) as
        { salt: string; passwordHash: string } | undefined;
      if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
        response.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
        response.end(page('Log in', `<h1>Log in</h1>\n  <p class="error">Invalid credentials</p>`));
        return;
      }
      const token = createHmac('sha256', randomBytes(32).toString('hex'))
        .update(`${email}:${Date.now()}:${randomBytes(8).toString('hex')}`)
        .digest('hex');
      db.prepare('INSERT INTO sessions (token, email, createdAt) VALUES (?, ?, ?)').run(
        token,
        email,
        Date.now(),
      );
      // The defect classes under proof (#257/#258): the post-login redirect
      // target is /dashboard, NOT '/'.
      response.writeHead(302, {
        location: '/dashboard',
        'set-cookie': `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`,
      });
      response.end();
      return;
    }

    if (request.method === 'GET' && url.pathname === '/dashboard') {
      const email = sessionEmail(request);
      if (!email) {
        response.writeHead(302, { location: '/login' });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(dashboardPage());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/newsletter') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(newsletterPage());
      return;
    }

    // Generic NON-AUTH form flow: subscribe and redirect to a dedicated
    // thanks page — the same goto/fill/submit/assert shape as login, in a
    // different domain, with no session semantics at all.
    if (request.method === 'POST' && url.pathname === '/newsletter/subscribe') {
      const form = parseUrlencoded(await readBody(request));
      const email = (form.get('email') ?? '').trim().toLowerCase();
      if (email.length === 0 || !email.includes('@')) {
        response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        response.end(
          page(
            'Newsletter',
            `<h1>Newsletter</h1>\n  <p class="error">A valid email is required</p>`,
          ),
        );
        return;
      }
      db.prepare('INSERT OR IGNORE INTO subscribers (id, email, createdAt) VALUES (?, ?, ?)').run(
        `sub_${randomBytes(8).toString('hex')}`,
        email,
        Date.now(),
      );
      response.writeHead(302, { location: '/newsletter/thanks' });
      response.end();
      return;
    }

    if (request.method === 'GET' && url.pathname === '/newsletter/thanks') {
      const count = (
        db.prepare('SELECT COUNT(*) AS count FROM subscribers').get() as { count: number }
      ).count;
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(thanksPage(count));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(302, { location: sessionEmail(request) ? '/dashboard' : '/login' });
      response.end();
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: false, error: 'not found' }));
  }

  return { server };
}

export function startRedirectLoginApp(options: RedirectLoginAppOptions): Promise<{
  server: Server;
  origin: string;
}> {
  const { server } = createRedirectLoginApp(options);
  return new Promise((resolve) => {
    server.listen(options.port, '127.0.0.1', () => {
      resolve({ server, origin: options.origin });
    });
  });
}

export function stopRedirectLoginApp(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

export async function redirectAppReady(origin: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${origin}/newsletter`);
      if (response.ok) return;
    } catch {
      // Not accepting connections yet; keep waiting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Redirect login app readiness timed out at ${origin}`);
}

export async function resetAndSeedRedirectApp(
  origin: string,
  persona: Readonly<{ email: string; password: string }>,
): Promise<void> {
  const reset = await fetch(`${origin}/__arxic/reset`, { method: 'POST' });
  if (!reset.ok) throw new Error(`Fixture reset returned ${reset.status}`);
  const seed = await fetch(`${origin}/__arxic/seed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ personaId: 'dg09-redirect-user', ...persona }),
  });
  if (!seed.ok) throw new Error(`Fixture seed returned ${seed.status}`);
}
