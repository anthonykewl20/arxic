import { createServer as createHttpServer, type Server } from 'node:http';
import { once } from 'node:events';
import { rm } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';

/**
 * #302 (F-E3B): the dg11 attestation front must not break baked-origin SPA
 * targets.
 *
 * Campaign round 3 measured koel dead behind the front: its built HTML bakes
 * ABSOLUTE asset URLs (http://<app-origin>/build/...), so an origin-differing
 * front proxy makes every script load cross-origin → CORS-blocked → the SPA
 * never boots (crawl shell: 0 forms / 0 controls / 0 links; SURFACE-009 —
 * the login form cannot even be found). Reproduced with a faithful replica
 * of the front's forwarding semantics (see the #256 finding comment).
 *
 * Latent second defect: `Object.fromEntries(upstream.headers.entries())`
 * keeps only the LAST set-cookie — Laravel's XSRF-TOKEN + session pairs lose
 * their first member.
 */
describe('#302 (F-E3B) attestation front: baked-origin SPA + set-cookie fidelity', () => {
  let upstream: Server;
  let upstreamOrigin: string;
  let front: { origin: string; stop: () => Promise<void> };
  const temporaryDirectories: string[] = [];

  const DIGEST = 'a'.repeat(64);

  beforeAll(async () => {
    // A stub "baked-origin SPA" upstream: the HTML references its assets by
    // ABSOLUTE app-origin URLs (the koel build shape), the asset serves
    // executable JS that renders a form, and / leaks two set-cookies.
    upstream = createHttpServer((request, response) => {
      const url = request.url ?? '/';
      if (url === '/' || url.startsWith('/?')) {
        response.statusCode = 200;
        // Two set-cookie headers — the front must forward BOTH.
        response.setHeader('set-cookie', [
          'XSRF-TOKEN=first-cookie-value; path=/',
          'arxic_session=second-cookie-value; path=/',
        ]);
        response.setHeader('content-type', 'text/html');
        response.end(`<!doctype html><html><head><title>baked</title></head>
<body><div id="root"></div>
<script src="http://127.0.0.1:${(upstream.address() as { port: number }).port}/build/app.js"></script>
</body></html>`);
        return;
      }
      if (url === '/build/app.js') {
        response.statusCode = 200;
        response.setHeader('content-type', 'application/javascript');
        response.end(
          `document.getElementById('root').innerHTML = '<form method="post" action="/login">' +
            '<input name="email" placeholder="Email">' +
            '<input name="password" type="password" placeholder="Password">' +
            '<button type="submit">Log In</button></form>';`,
        );
        return;
      }
      response.statusCode = 404;
      response.end('not found');
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    upstreamOrigin = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;

    const validation = await import('../../scripts/dg11-run-validation');
    // The front's constructor is private; start() is the public seam.
    front = await validation.AttestationFront.start({
      appOrigin: upstreamOrigin,
      buildDigest: DIGEST,
    });
  }, 60_000);

  afterAll(async () => {
    await front?.stop();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await Promise.all(
      temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('boots a baked-origin SPA behind the front (absolute asset URLs rewrite to the proxy origin)', async () => {
    // Substitute the baked placeholder with the real upstream port (the stub
    // cannot know it before listen); the page is then served THROUGH the
    // front so the rewrite is what makes it boot.
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const failed: string[] = [];
      page.on('requestfailed', (request) => failed.push(request.url()));
      // The baked HTML references the UPSTREAM origin for its script; through
      // the front that load is cross-origin (CORS-blocked) unless the front
      // rewrites the body. Goto the front origin (the crawl's perspective).
      await page.goto(front.origin, { waitUntil: 'load' });
      // The SPA's script renders the login form — only possible if the
      // script actually loaded (same-origin through the rewrite).
      await page.waitForSelector('form', { state: 'attached', timeout: 8_000 });
      const forms = await page.locator('form').count();
      expect(forms).toBe(1);
      expect(
        await page.getByPlaceholder('Email').count(),
        'the booted SPA renders its placeholder-addressed form',
      ).toBe(1);
      expect(failed).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it('forwards EVERY upstream set-cookie header (no set-cookie collapsing)', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(front.origin, { waitUntil: 'load' });
      const state = await context.storageState();
      const names = state.cookies
        .filter((cookie) => cookie.domain === '127.0.0.1')
        .map((cookie) => cookie.name)
        .sort();
      expect(names).toEqual(['XSRF-TOKEN', 'arxic_session']);
      await context.close();
    } finally {
      await browser.close();
    }
  }, 60_000);

  it('serves the well-known attestation unchanged (regression half)', async () => {
    const response = await fetch(`${front.origin}/.well-known/arxic-test-target.json`);
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      environmentClass: string;
      origin: string;
      buildDigest: string;
    };
    expect(json.environmentClass).toBe('local-test');
    expect(json.origin).toBe(front.origin);
    expect(json.buildDigest).toBe(DIGEST);
  }, 30_000);
});
