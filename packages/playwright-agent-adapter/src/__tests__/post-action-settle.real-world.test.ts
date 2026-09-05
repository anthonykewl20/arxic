import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { PlaywrightExplorationDriver } from '../exploration-driver';

it.each([true, false])(
  'observes an asynchronous submit only after its outcome settles (respond=%s)',
  async (respond) => {
    const server = createServer((request, response) => {
      if (request.url === '/session') {
        if (respond) setTimeout(() => response.end('{}'), 400);
        return;
      }
      response.setHeader('content-type', 'text/html');
      response.end(
        request.url === '/home'
          ? '<main><h1>Signed in</h1></main>'
          : "<main><h1>Login</h1><button onclick=\"fetch('/session', {method:'POST'}).then(() => location.href='/home')\">Login</button></main>",
      );
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected ephemeral TCP port');
    const origin = `http://127.0.0.1:${address.port}`;
    const driver = new PlaywrightExplorationDriver({ timeoutMs: respond ? 3000 : 500 });
    try {
      const result = await driver.execute(
        [
          { kind: 'navigate', intent: 'open login', url: `${origin}/login` },
          {
            kind: 'click',
            intent: 'submit login',
            locator: {
              semantic: { kind: 'role', role: 'button', name: 'Login', exact: true },
              execution: { kind: 'role', role: 'button', name: 'Login', exact: true },
            },
          },
        ],
        { allowedOrigin: origin },
      );
      const submit = result.observations.at(-1)!;
      if (respond) {
        expect(submit.ok).toBe(true);
        expect(submit.url).toBe(`${origin}/home`);
        expect(JSON.stringify(submit.accessibilitySnapshot)).toContain('Signed in');
      } else {
        expect(submit.ok).toBe(false);
        expect(submit.error).toContain('did not settle');
      }
    } finally {
      await driver.close();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
  },
  10_000,
);
