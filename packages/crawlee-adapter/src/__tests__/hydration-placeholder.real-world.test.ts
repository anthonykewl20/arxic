import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { CrawleeSurfaceDiscoverer } from '..';

/**
 * DG-297 E1 (#297): the runtime surface tier must SEE auth-gated SPA login
 * forms. Both ratified DG-12 targets (F-E, issuecomment-5395828801) crawled
 * to 1 route / 0 forms because (a) their forms commit only AFTER hydration,
 * which settles after the load event, and (b) their inputs are
 * placeholder-only (no <label>, no aria-label — or a literal "undefined"
 * aria-label binding artifact), which the probe's label chain drops. These
 * tests run the REAL adapter (real Chromium through Crawlee) against REAL
 * HTTP servers shaped like the observed target markup.
 */

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  server.close();
  await once(server, 'close');
  server = undefined;
});

describe('DG-297 E1: hydration-delayed placeholder-only forms are inventoried', () => {
  it('records the post-hydration form with placeholder-derived field labels', async () => {
    server = createServer((_request, response) => {
      response.setHeader('content-type', 'text/html');
      // directus-shaped: the form exists only after the SPA script mounts
      // it (observed: probe-at-load sees zero forms on /admin/login).
      response.end(`<!doctype html><html><head><title>spa target</title></head><body>
<div id="root"></div>
<script>
  setTimeout(function () {
    document.getElementById('root').innerHTML =
      '<form method="post" action="/auth/login">' +
      '<input name="email" type="email" placeholder="Email" required />' +
      '<input name="password" type="password" placeholder="Password" required />' +
      '<button type="submit">Sign In</button>' +
      '</form>';
  }, 700);
</script>
</body></html>`);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not allocate test port');
    const adapter = new CrawleeSurfaceDiscoverer({ maxRequestRetries: 0 });

    const result = await adapter.collect({
      origin: `http://127.0.0.1:${address.port}`,
      maxUrls: 1,
      maxDepth: 0,
    });

    const root = result.routes.find((route) => route.path === '/');
    expect(root).toBeDefined();
    const form = root?.forms.find((candidate) => candidate.method === 'POST');
    expect(form).toBeDefined();
    // Placeholder-derived labels — the same label-first-then-placeholder
    // semantics the verifier adopted in #295.
    expect(form?.controls).toContainEqual(
      expect.objectContaining({ tag: 'input', type: 'email', label: 'Email' }),
    );
    expect(form?.controls).toContainEqual(
      expect.objectContaining({ tag: 'input', type: 'password', label: 'Password' }),
    );
    // The submit control's own text remains its label (existing semantics).
    expect(form?.controls).toContainEqual(
      expect.objectContaining({ tag: 'button', type: 'submit', label: 'Sign In' }),
    );
  }, 120_000);

  it('derives labels from placeholders when the aria-label is the literal binding artifact "undefined" (koel shape)', async () => {
    server = createServer((_request, response) => {
      response.setHeader('content-type', 'text/html');
      // koel-shaped: hydrated form whose inputs carry aria-label="undefined"
      // (an upstream Vue binding artifact observed on the ratified pin) —
      // the placeholder is the only honest label source.
      response.end(`<!doctype html><html><head><title>koel shape</title></head><body>
<div id="root"></div>
<script>
  setTimeout(function () {
    document.getElementById('root').innerHTML =
      '<form method="post" action="/login">' +
      '<input name="email" type="email" aria-label="undefined" placeholder="Your email address" required />' +
      '<input name="password" type="password" aria-label="undefined" placeholder="Your password" required />' +
      '<button type="submit">Log In</button>' +
      '</form>';
  }, 700);
</script>
</body></html>`);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not allocate test port');
    const adapter = new CrawleeSurfaceDiscoverer({ maxRequestRetries: 0 });

    const result = await adapter.collect({
      origin: `http://127.0.0.1:${address.port}`,
      maxUrls: 1,
      maxDepth: 0,
    });

    const form = result.routes
      .find((route) => route.path === '/')
      ?.forms.find((candidate) => candidate.method === 'POST');
    expect(form).toBeDefined();
    expect(form?.controls).toContainEqual(expect.objectContaining({ label: 'Your email address' }));
    expect(form?.controls).toContainEqual(expect.objectContaining({ label: 'Your password' }));
  }, 120_000);

  it('keeps a real label winning over a placeholder (label-first precedence)', async () => {
    server = createServer((_request, response) => {
      response.setHeader('content-type', 'text/html');
      response.end(`<!doctype html><html><head><title>labelled</title></head><body>
<form method="post" action="/login">
  <label>Email address<input name="email" type="email" placeholder="Email" required /></label>
  <input name="password" type="password" placeholder="Password" required />
  <button type="submit">Login</button>
</form>
</body></html>`);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not allocate test port');
    const adapter = new CrawleeSurfaceDiscoverer({ maxRequestRetries: 0 });

    const result = await adapter.collect({
      origin: `http://127.0.0.1:${address.port}`,
      maxUrls: 1,
      maxDepth: 0,
    });

    const form = result.routes
      .find((route) => route.path === '/')
      ?.forms.find((candidate) => candidate.method === 'POST');
    expect(form?.controls).toContainEqual(expect.objectContaining({ label: 'Email address' }));
    expect(form?.controls).toContainEqual(expect.objectContaining({ label: 'Password' }));
  }, 120_000);
});
