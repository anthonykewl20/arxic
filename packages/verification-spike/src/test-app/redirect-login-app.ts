// DG-03 real-world proof target: a REAL minimal web application whose post-login
// redirect goes to /dashboard (NOT '/'), exercising the #257 defect class that
// both Arxic fixture apps cannot (reference-auth-app redirects to '/', see
// app/login/actions.ts:28; vulnerable-auth-app redirects 302 to
// '/?message=Logged%20in', see src/server.ts:47). Real engines only: node:http,
// node:sqlite (DatabaseSync), node:crypto (scrypt password hashing, HMAC session
// tokens, HMAC-verified webhook signatures). Zero external dependencies.
//
// Surface:
//   GET  /login                              — labelled login form (Email/Password, "Log in")
//   POST /login                              — scrypt verify → session cookie → 302 /dashboard
//   GET  /dashboard                          — requires session; <h1>Dashboard</h1>; else 302 /login
//   POST /api/webhooks/order.created         — HMAC-SHA256-verified webhook; persists the order
//   GET  /api/orders/by-event/:providerEventId — read-only side-effect check
//   POST /__arxic/seed | /__arxic/reset      — fixture control (same contract as the fixture apps)
//   GET  /.well-known/arxic-test-target.json — target attestation
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { sha256 } from '@arxic/contracts';

export const REDIRECT_APP_BUILD = 'dg03-redirect-login-app@0.1.1' as const;
export const REDIRECT_APP_NONCE = 'dg03-redirect-login-app-v1' as const;

export type RedirectLoginAppOptions = Readonly<{
  port: number;
  dbPath: string;
  origin: string;
  webhookSecretEnv?: string;
}>;

const MAX_BODY_BYTES = 1_000_000;
const SESSION_COOKIE = 'dg03_session';
const WEBHOOK_SIGNATURE_HEADER = 'x-arxic-signature';

type WebhookSecret = Readonly<{ secret: string }>;

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

function loginPage(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Log in</title></head>
<body>
<main>
  <h1>Log in</h1>
  <form method="post" action="/login">
    <label>Email<input name="email" type="email" autocomplete="username" required></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
    <button type="submit">Log in</button>
  </form>
</main>
</body>
</html>`;
}

function dashboardPage(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Dashboard</title></head>
<body>
<main>
  <h1>Dashboard</h1>
  <p>Welcome back. Orders sync automatically.</p>
</main>
</body>
</html>`;
}

export function createRedirectLoginApp(options: RedirectLoginAppOptions): {
  server: Server;
  webhookSecret: WebhookSecret;
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
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      providerEventId TEXT NOT NULL UNIQUE,
      orderNumber TEXT NOT NULL,
      amount TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
  `);

  const webhookSecret: WebhookSecret = {
    secret:
      process.env[options.webhookSecretEnv ?? 'ARXIC_INPUT_WEBHOOK_SECRET'] ??
      randomBytes(32).toString('hex'),
  };

  const sessionEmail = (request: IncomingMessage): string | undefined => {
    const cookie = request.headers.cookie ?? '';
    const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
    if (!match) return undefined;
    const token = match[1]!;
    const row = db.prepare('SELECT email FROM sessions WHERE token = ?').get(token) as
      { email: string } | undefined;
    return row?.email;
  };

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'internal error' }));
      server.emit('app-error', error);
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
      db.exec('DELETE FROM sessions; DELETE FROM orders; DELETE FROM users;');
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
        response.end(
          loginPage().replace('<main>', '<main><p class="error">Invalid credentials</p>'),
        );
        return;
      }
      const token = createHmac('sha256', webhookSecret.secret)
        .update(`${email}:${Date.now()}:${randomBytes(8).toString('hex')}`)
        .digest('hex');
      db.prepare('INSERT INTO sessions (token, email, createdAt) VALUES (?, ?, ?)').run(
        token,
        email,
        Date.now(),
      );
      // The defect class under proof (#257): the post-login redirect target is
      // /dashboard, NOT '/'.
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

    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(302, { location: sessionEmail(request) ? '/dashboard' : '/login' });
      response.end();
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/webhooks/order.created') {
      const raw = await readBody(request);
      const signatureHeader = request.headers[WEBHOOK_SIGNATURE_HEADER];
      const provided = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
      const expected = `sha256=${createHmac('sha256', webhookSecret.secret).update(raw).digest('hex')}`;
      const providedBuffer = Buffer.from(provided ?? '', 'utf8');
      const expectedBuffer = Buffer.from(expected, 'utf8');
      const signatureValid =
        providedBuffer.length === expectedBuffer.length &&
        timingSafeEqual(providedBuffer, expectedBuffer);
      if (!signatureValid) {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: false, error: 'invalid signature' }));
        return;
      }
      let payload: {
        eventType?: unknown;
        providerEventId?: unknown;
        orderNumber?: unknown;
        amount?: unknown;
      };
      try {
        payload = JSON.parse(raw.toString('utf8'));
      } catch {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: false, error: 'invalid JSON' }));
        return;
      }
      if (
        typeof payload.providerEventId !== 'string' ||
        typeof payload.orderNumber !== 'string' ||
        typeof payload.amount !== 'string'
      ) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: false, error: 'invalid order payload' }));
        return;
      }
      const orderId = `ord_${randomBytes(8).toString('hex')}`;
      try {
        db.prepare(
          'INSERT INTO orders (id, providerEventId, orderNumber, amount, createdAt) VALUES (?, ?, ?, ?, ?)',
        ).run(orderId, payload.providerEventId, payload.orderNumber, payload.amount, Date.now());
      } catch {
        response.writeHead(409, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: false, error: 'duplicate provider event' }));
        return;
      }
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, orderId }));
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/orders/by-event/')) {
      const providerEventId = decodeURIComponent(
        url.pathname.slice('/api/orders/by-event/'.length),
      );
      const order = db
        .prepare(
          'SELECT id, providerEventId, orderNumber, amount FROM orders WHERE providerEventId = ?',
        )
        .get(providerEventId) as
        { id: string; providerEventId: string; orderNumber: string; amount: string } | undefined;
      if (!order) {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: false, error: 'no such order' }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          orderId: order.id,
          providerEventId: order.providerEventId,
          orderNumber: order.orderNumber,
          amount: order.amount,
        }),
      );
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: false, error: 'not found' }));
  }

  return { server, webhookSecret };
}

export function startRedirectLoginApp(options: RedirectLoginAppOptions): Promise<{
  server: Server;
  webhookSecret: WebhookSecret;
  origin: string;
}> {
  const { server, webhookSecret } = createRedirectLoginApp(options);
  return new Promise((resolve) => {
    server.listen(options.port, '127.0.0.1', () => {
      resolve({ server, webhookSecret, origin: options.origin });
    });
  });
}

export function stopRedirectLoginApp(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
