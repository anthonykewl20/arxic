import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { CrawleeSurfaceDiscoverer } from '..';

/**
 * DG-297 E2 (#297): the crawl tier authenticates through the target's OWN
 * login form (the #288 replayPersona declaration, #295 resolution semantics)
 * before breadth discovery, so auth-gated SPA/page surfaces are inventoried
 * instead of only the login view. REAL HTTP app + REAL Chromium through the
 * adapter; session state is a REAL cookie set by a REAL form POST.
 *
 * Honesty contract: without the declaration the crawl is byte-identical to
 * today (login view only); a refused login emits a blocked diagnostic and
 * still maps the anonymous tier — never a fabricated authenticated surface.
 */

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  server.close();
  await once(server, 'close');
  server = undefined;
});

async function startAuthApp(options: { refuseLogin?: boolean } = {}): Promise<string> {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const authenticated = /arxic-session=e2e-session-token/u.test(request.headers.cookie ?? '');
    if (url.pathname === '/' && !authenticated) {
      response.statusCode = 302;
      response.setHeader('location', '/login');
      response.end();
      return;
    }
    if (url.pathname === '/' && authenticated) {
      response.setHeader('content-type', 'text/html');
      response.end(`<!doctype html><html><head><title>app home</title></head><body>
<h1>Dashboard</h1>
<a href="/newsletter">Newsletter</a>
<form method="post" action="/profile">
  <label>Display name<input name="name" type="text" required /></label>
  <button type="submit">Save profile</button>
</form>
</body></html>`);
      return;
    }
    if (url.pathname === '/newsletter' && authenticated) {
      response.setHeader('content-type', 'text/html');
      response.end(`<!doctype html><html><head><title>newsletter</title></head><body>
<form method="post" action="/newsletter">
  <input name="email" type="email" placeholder="Email" required />
  <button type="submit">Subscribe</button>
</form>
</body></html>`);
      return;
    }
    if (url.pathname === '/login' && request.method === 'GET') {
      response.setHeader('content-type', 'text/html');
      response.end(`<!doctype html><html><head><title>sign in</title></head><body>
<form method="post" action="/login">
  <input name="email" type="email" placeholder="Email" required />
  <input name="password" type="password" placeholder="Password" required />
  <button type="submit">Login</button>
</form>
</body></html>`);
      return;
    }
    if (url.pathname === '/login' && request.method === 'POST') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const fields = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
        const accepted =
          !options.refuseLogin &&
          fields.get('email') === 'persona@example.test' &&
          fields.get('password') === 'PersonaPass9!';
        if (accepted) {
          response.statusCode = 303;
          response.setHeader('location', '/');
          response.setHeader('set-cookie', 'arxic-session=e2e-session-token; Path=/; HttpOnly');
          response.end();
        } else {
          // The honest refused-login shape (as real apps and the #288/#295
          // fixtures): the form RE-RENDERS with the error — a form-less
          // error page would read as "form detached = success" under the
          // #295 DOM-detachment success signal.
          response.statusCode = 200;
          response.setHeader('content-type', 'text/html');
          response.end(`<!doctype html><html><head><title>sign in</title></head><body>
<p>Invalid credentials</p>
<form method="post" action="/login">
  <input name="email" type="email" placeholder="Email" required />
  <input name="password" type="password" placeholder="Password" required />
  <button type="submit">Login</button>
</form>
</body></html>`);
        }
      });
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate test port');
  return `http://127.0.0.1:${address.port}`;
}

const DECLARATION: import('@arxic/verifier').ReplayPersonaDeclaration = {
  mode: 'per-pass-login',
  login: {
    route: '/login',
    fields: [
      { label: 'Email', inputRef: 'persona.email' },
      { label: 'Password', inputRef: 'persona.password' },
    ],
    submit: { label: 'Login' },
  },
};

describe('DG-297 E2: authenticated breadth discovery via replayPersona', () => {
  it('crawls the authenticated tier when the declaration resolves, and the anonymous tier otherwise', async () => {
    const anonymousOrigin = await startAuthApp();
    const adapter = new CrawleeSurfaceDiscoverer({ maxRequestRetries: 0 });

    // Without the declaration: only the login view is reachable (today's
    // behavior, byte-identical).
    const anonymous = await adapter.collect({
      origin: anonymousOrigin,
      maxUrls: 6,
      maxDepth: 1,
    });
    const anonymousPaths = anonymous.routes.map((route) => route.path);
    expect(anonymousPaths).toContain('/login');
    expect(anonymousPaths).not.toContain('/newsletter');

    // With the declaration: the authenticated interior is inventoried,
    // including placeholder-labelled forms (E1 semantics composed).
    const authenticatedOrigin = await startAuthApp();
    const authenticated = await adapter.collect({
      origin: authenticatedOrigin,
      maxUrls: 6,
      maxDepth: 1,
      replayPersona: {
        declaration: DECLARATION,
        persona: { email: 'persona@example.test', password: 'PersonaPass9!' },
      },
    });
    const paths = authenticated.routes.map((route) => route.path);
    expect(paths).toContain('/');
    expect(paths).toContain('/newsletter');
    expect(
      authenticated.routes
        .find((route) => route.path === '/newsletter')
        ?.forms.some((form) =>
          form.controls.some((control) => control.label === 'Email' && control.type === 'email'),
        ),
    ).toBe(true);

    // The pre-crawl login interacted with this real anonymous form before its
    // cookie seeded breadth discovery. Keep that surface: an authenticated
    // crawl cannot reach it again. The capture stays structural — neither
    // persona value may cross the adapter boundary into the recorded map.
    const login = authenticated.routes.find((route) => route.path === '/login');
    expect(login?.forms).toContainEqual(
      expect.objectContaining({
        action: `${authenticatedOrigin}/login`,
        method: 'POST',
        controls: expect.arrayContaining([
          expect.objectContaining({ tag: 'input', type: 'email', label: 'Email' }),
          expect.objectContaining({ tag: 'input', type: 'password', label: 'Password' }),
          expect.objectContaining({ tag: 'button', type: 'submit', label: 'Login' }),
        ]),
      }),
    );
    expect(JSON.stringify(login)).not.toContain('persona@example.test');
    expect(JSON.stringify(login)).not.toContain('PersonaPass9!');
  }, 180_000);

  it('emits a blocked diagnostic and still maps the anonymous tier when the login is refused', async () => {
    const origin = await startAuthApp({ refuseLogin: true });
    const adapter = new CrawleeSurfaceDiscoverer({ maxRequestRetries: 0 });

    const result = await adapter.collect({
      origin,
      maxUrls: 6,
      maxDepth: 1,
      replayPersona: {
        declaration: DECLARATION,
        persona: { email: 'persona@example.test', password: 'PersonaPass9!' },
      },
    });

    expect(result.routes.map((route) => route.path)).toContain('/login');
    expect(result.routes.map((route) => route.path)).not.toContain('/newsletter');
    const blocked = result.diagnostics.find(
      (diagnostic) => diagnostic.code === 'ARXIC-SURFACE-009',
    );
    expect(blocked).toEqual(
      expect.objectContaining({
        code: 'ARXIC-SURFACE-009',
        severity: 'blocked',
      }),
    );
    // #301 (AC-4): the diagnostic carries the login core's underlying
    // failure (bounded) so a refusal is diagnosable from evidence alone.
    expect(String(blocked?.message)).toMatch(/login core: .+/u);
    // The persona secret never leaks into the diagnostic surface.
    expect(JSON.stringify(result.diagnostics)).not.toContain('PersonaPass9!');
  }, 180_000);
});
