// #383 test-support REAL local web application reproducing the captured
// koel login shape (koel @ dfec91ff, live capture 2026-09-04): the submit
// control is a label-wrapped <button type="submit">Log In</button> whose
// accessible name is EMPTY in Chromium's a11y tree (live aria snapshot:
// `- button: Log In` — text content only) while the inputs carry koel's
// build quirk aria-label="undefined" and are placeholder-addressed. The
// compiled via-lane submit binding (role + accessible name) can never bind
// this shape; this app pins the name-or-text fallback. Real engines only:
// node:http. Zero external dependencies. TEST SUPPORT surface, not product
// code.
//
// Surface:
//   GET  /            — the koel-shape login form (placeholders, unnamed submit)
//   POST /login       — 302 /done
//   GET  /done        — <h1>Signed In</h1>
//   GET  /ambiguous   — same form PLUS a second button so the name-branch and
//                       the text-branch match DIFFERENT controls (strict-mode
//                       refusal pin — no silent pick): the extra button is
//                       NAMED "Log In" (aria-label) with text "Process", so
//                       getByRole(name:'Log In') matches it while the exact-
//                       text branch matches the unnamed submit.
import { createServer, type Server } from 'node:http';

export type UnnamedSubmitApp = Readonly<{
  server: Server;
  origin: string;
}>;

export function unnamedSubmitFormHtml(variant: 'plain' | 'ambiguous'): string {
  const ambiguousButton =
    variant === 'ambiguous'
      ? '\n    <label class="x"><!--v--><button type="submit" aria-label="Log In">Process</button></label>'
      : '';
  return `<!doctype html><html><body><main>
  <h1>Test App</h1>
  <form method="post" action="/login" data-testid="login-form">
    <label class="x"><!--v--><input aria-label="undefined" type="email" name="email" placeholder="Your email address" required></label>
    <label class="x"><!--v--><input aria-label="undefined" type="password" name="password" placeholder="Your password" required></label>
    <label class="x"><!--v--><button type="submit">Log In</button></label>${ambiguousButton}
    <a role="button"> Forgot password? </a>
  </form></main></body></html>`;
}

export async function startUnnamedSubmitApp(): Promise<UnnamedSubmitApp> {
  const server = createServer((request, response) => {
    response.on('error', () => {});
    const url = request.url ?? '/';
    if (request.method === 'GET' && url === '/') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(unnamedSubmitFormHtml('plain'));
      return;
    }
    if (request.method === 'GET' && url === '/ambiguous') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(unnamedSubmitFormHtml('ambiguous'));
      return;
    }
    if (request.method === 'POST' && url === '/login') {
      response.writeHead(302, { location: '/done' });
      response.end();
      return;
    }
    if (request.method === 'GET' && url === '/done') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<!doctype html><html><body><main><h1>Signed In</h1></main></body></html>');
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address !== 'object') throw new Error('could not allocate port');
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

export async function stopUnnamedSubmitApp(server: Server): Promise<void> {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}
