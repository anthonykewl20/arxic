import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlaywrightExplorationDriver } from '../exploration-driver';

/**
 * #301 follow-up (campaign round 4): the DG-08 formScope filter counted
 * forms ONCE, immediately, with no settle — on the real directus login the
 * SPA re-renders its form after hydration (the navigate step's observation
 * lands mid-swap), so the scoped-form count read 0 and EVERY fill/submit
 * failed closed as semantic-ambiguous (reproduced deterministically 4/4
 * through the attestation front; t0 scoped form = 0, t+300ms = 1).
 *
 * The scope resolution must WAIT (bounded) for the page to expose exactly
 * one scoped form before applying the fail-closed ambiguity gate — the same
 * settle the control locators already get from their attach-wait.
 */
describe('#301 follow-up real Chromium: formScope settles across a re-render', () => {
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      response.statusCode = 200;
      response.setHeader('content-type', 'text/html');
      // The app shell renders EMPTY; the form attaches ~400ms later — the
      // post-hydration re-render shape measured on directus /admin.
      response.end(`<!doctype html><html><body><div id="app"></div>
<script>
  setTimeout(() => {
    document.getElementById('app').innerHTML =
      '<form method="post" action="/login">' +
      '<input name="email" placeholder="Email">' +
      '<input name="password" type="password" placeholder="Password">' +
      '<button type="submit">Sign In</button></form>';
  }, 400);
</script>
</body></html>`);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('waits (bounded) for the scoped form to reach exactly one across the re-render', async () => {
    const driver = new PlaywrightExplorationDriver({ timeoutMs: 5_000 });
    try {
      const result = await driver.execute(
        [
          { intent: 'observe route', kind: 'navigate', url: `${origin}/` },
          {
            intent: 'fill Email',
            kind: 'fill',
            locator: {
              semantic: { kind: 'label', text: 'Email', exact: true },
              execution: { kind: 'label', text: 'Email', exact: true },
            },
            formScope: { fieldLabel: 'Email', submitName: 'Sign In' },
            value: 'persona@example.test',
          },
        ],
        { allowedOrigin: origin },
      );
      expect(result.observations.map((observation) => observation.ok)).toEqual([true, true]);
      expect(result.observations[1]?.locatorResolution).toEqual(
        expect.objectContaining({ resolved: true }),
      );
    } finally {
      await driver.close();
    }
  }, 60_000);

  it('still fails closed (ambiguous) when two scoped forms exist and stay', async () => {
    const ambiguous = createServer((request, response) => {
      response.statusCode = 200;
      response.setHeader('content-type', 'text/html');
      response.end(`<!doctype html><html><body>
<form method="post" action="/a"><input placeholder="Email"><button>Sign In</button></form>
<form method="post" action="/b"><input placeholder="Email"><button>Sign In</button></form>
</body></html>`);
    });
    ambiguous.listen(0, '127.0.0.1');
    await once(ambiguous, 'listening');
    const ambiguousOrigin = `http://127.0.0.1:${(ambiguous.address() as { port: number }).port}`;
    const driver = new PlaywrightExplorationDriver({ timeoutMs: 2_000 });
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
            formScope: { fieldLabel: 'Email', submitName: 'Sign In' },
            value: 'persona@example.test',
          },
        ],
        { allowedOrigin: ambiguousOrigin },
      );
      expect(result.observations[0]?.ok).toBe(false);
      expect(result.observations[0]?.locatorResolution).toEqual(
        expect.objectContaining({
          resolved: false,
          reason: 'form-scope-ambiguous',
          diagnostic: { phase: 'form-scope', candidateCount: 2 },
        }),
      );
    } finally {
      await driver.close();
      await new Promise<void>((resolve) => ambiguous.close(() => resolve()));
    }
  }, 60_000);
});
