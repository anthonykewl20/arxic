import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { PlaywrightExplorationDriver } from '../exploration-driver';

/**
 * #301 (F-E3A): placeholder-addressed forms in the exploration lane.
 *
 * The real directus login page (reached by campaign round 3 after the #299
 * plan-lane fix) has ZERO <label> elements — its inputs are addressed by
 * placeholder only. The crawl (E1) resolves control labels through
 * aria-label || <label> || placeholder, but the exploration lane consumes
 * those labels with label-only semantics (getByLabel) — both the fill
 * locators and the DG-08 formScope filter — so every fill/submit blocked
 * ARXIC-EXPLORATION-LOCATOR-AMBIGUOUS on the live target.
 *
 * This is the real-Chromium reproduction: a placeholder-only form (no
 * <label>, no aria-label — the directus shape), driven through the real
 * driver with a formScope, must resolve and submit.
 */
describe('#301 (F-E3A) real Chromium: placeholder-addressed form drives through the exploration lane', () => {
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const url = request.url ?? '/';
      if (url === '/' || url.startsWith('/?')) {
        response.statusCode = 200;
        response.setHeader('content-type', 'text/html');
        response.end(`<!doctype html><html><head><title>sign in</title></head><body>
<h1>Sign in to continue</h1>
<form method="post" action="/login">
  <input name="email" type="email" placeholder="Email" required />
  <input name="password" type="password" placeholder="Password" required />
  <button type="submit">Sign In</button>
</form>
</body></html>`);
        return;
      }
      if (url === '/login' && request.method === 'POST') {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const accepted =
            body.includes('email=admin%40example.test') && body.includes('password=Hunter2%21');
          response.statusCode = 302;
          response.setHeader('location', accepted ? '/done' : '/');
          response.end();
        });
        return;
      }
      if (url === '/done') {
        response.statusCode = 200;
        response.setHeader('content-type', 'text/html');
        response.end(
          '<!doctype html><html><body><h1>Signed In</h1><p>Session active</p></body></html>',
        );
        return;
      }
      response.statusCode = 404;
      response.end('not found');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('resolves and drives a placeholder-only form (label-first with placeholder fallback)', async () => {
    const driver = new PlaywrightExplorationDriver();
    try {
      const result = await driver.execute(
        [
          {
            intent: 'fill Email',
            kind: 'fill',
            url: `${origin}/`,
            locator: {
              semantic: { kind: 'label', text: 'Email', exact: true },
              execution: { kind: 'label', text: 'Email', exact: true },
            },
            formScope: { fieldLabel: 'Email', submitName: 'Sign In' },
            value: 'admin@example.test',
          },
          {
            intent: 'fill Password',
            kind: 'fill',
            locator: {
              semantic: { kind: 'label', text: 'Password', exact: true },
              execution: { kind: 'label', text: 'Password', exact: true },
            },
            formScope: { fieldLabel: 'Email', submitName: 'Sign In' },
            value: 'Hunter2!',
          },
          {
            intent: 'submit Sign In',
            kind: 'click',
            locator: {
              semantic: { kind: 'role', role: 'button', name: 'Sign In', exact: true },
              execution: { kind: 'role', role: 'button', name: 'Sign In', exact: true },
            },
            formScope: { fieldLabel: 'Email', submitName: 'Sign In' },
          },
        ],
        { allowedOrigin: origin },
      );

      // Before the fix this is exactly the campaign shape: every fill/submit
      // fails closed with semantic-ambiguous (getByLabel matches nothing on
      // a placeholder-only form, so the formScope filter matches zero forms).
      expect(result.observations.map((observation) => observation.ok)).toEqual([true, true, true]);
      for (const observation of result.observations) {
        expect(observation.locatorResolution).toEqual(expect.objectContaining({ resolved: true }));
      }
      // The driver snapshots immediately after the click (no post-navigation
      // settle — driver timing is out of scope here); the accepted pattern
      // (see the reference-app locator-policy test) polls a follow-up
      // snapshot step until the post-submit page renders.
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const after = await driver.execute(
          [{ intent: 'observe signed-in transition', kind: 'snapshot' }],
          { allowedOrigin: origin },
        );
        const observation = after.observations[0];
        if (
          observation &&
          JSON.stringify(observation.accessibilitySnapshot).includes('Signed In')
        ) {
          // Fill values never leak into the sanitized accessibility snapshot.
          expect(JSON.stringify(observation.accessibilitySnapshot)).not.toContain(
            'admin@example.test',
          );
          expect(JSON.stringify(observation.accessibilitySnapshot)).not.toContain('Hunter2!');
          expect(observation.url).toBe(`${origin}/done`);
          return;
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
      }
      throw new Error('the placeholder-driven submit never reached the Signed In page');
    } finally {
      await driver.close();
    }
  }, 120_000);

  it('still blocks ambiguous placeholder addressing (two same-placeholder controls)', async () => {
    const ambiguous = createServer((request, response) => {
      response.statusCode = 200;
      response.setHeader('content-type', 'text/html');
      response.end(`<!doctype html><html><body>
<form method="post" action="/login">
  <input name="email" type="email" placeholder="Email" />
  <input name="email2" type="email" placeholder="Email" />
  <button type="submit">Sign In</button>
</form>
</body></html>`);
    });
    ambiguous.listen(0, '127.0.0.1');
    await once(ambiguous, 'listening');
    const ambiguousOrigin = `http://127.0.0.1:${(ambiguous.address() as { port: number }).port}`;
    const driver = new PlaywrightExplorationDriver();
    try {
      const result = await driver.execute(
        [
          {
            intent: 'fill Email',
            kind: 'fill',
            url: `${ambiguousOrigin}/`,
            locator: {
              semantic: { kind: 'label', text: 'Email', exact: true },
              execution: { kind: 'label', text: 'Email', exact: true },
            },
            value: 'admin@example.test',
          },
        ],
        { allowedOrigin: ambiguousOrigin },
      );
      // Two controls share the placeholder: the exactly-one gate must still
      // fail closed (ambiguous), never pick one arbitrarily.
      expect(result.observations[0]?.ok).toBe(false);
      expect(result.observations[0]?.locatorResolution).toEqual(
        expect.objectContaining({ resolved: false, reason: 'semantic-ambiguous' }),
      );
    } finally {
      await driver.close();
      await new Promise<void>((resolve) => ambiguous.close(() => resolve()));
    }
  }, 120_000);
});
