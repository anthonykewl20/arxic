import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CrawleeSurfaceDiscoverer } from '@arxic/crawlee-adapter';
import { PERSIST_REDACTED_LABEL, scanTextForSecrets } from '@arxic/bundle-promoter';
import { FileStageCheckpointer } from '..';

/**
 * Issue #474's live failure shape, end to end with real engines: a real page
 * (real HTTP server) whose email input carries the standard
 * `placeholder="you@example.com"`, inventoried by the REAL surface discoverer
 * (real Chromium through Crawlee) — the placeholder becomes the persisted
 * control label — then persisted through the REAL FileStageCheckpointer at
 * stage 5. Before the fix this refused with PersistedSecretError
 * ['email-address'] and blocked the whole campaign; after it the label is
 * masked and the artifact persists clean.
 */
let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  server.close();
  await once(server, 'close');
  server = undefined;
});

describe('real-world email-placeholder label masking (#474)', () => {
  it('persists a real placeholder-only email control masked instead of blocking stage 5', async () => {
    server = createServer((_request, response) => {
      response.setHeader('content-type', 'text/html');
      response.end(`<!doctype html><html><head><title>stack target</title></head><body>
<form method="post" action="/auth/login">
  <input name="email" type="email" placeholder="you@example.com" required />
  <input name="password" type="password" placeholder="Password" required />
  <button type="submit">Sign In</button>
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

    // The real probe really captured the placeholder into a label — the exact
    // content that fired the secrecy sweep on the live mightybox runs.
    const form = result.routes.find((route) => route.path === '/')?.forms.at(-1);
    expect(form?.controls).toContainEqual(
      expect.objectContaining({ tag: 'input', type: 'email', label: 'you@example.com' }),
    );

    const runsDirectory = await mkdtemp(join(tmpdir(), 'arxic-label-mask-real-'));
    const checkpointer = new FileStageCheckpointer(runsDirectory);
    await checkpointer.saveArtifact('label-mask-real', 5, {
      routes: result.routes.map((route) => ({
        path: route.path,
        forms: route.forms,
      })),
    });

    const bytes = await readFile(
      join(runsDirectory, 'label-mask-real', 'artifacts', '05.json'),
      'utf8',
    );
    expect(bytes).not.toContain('you@example.com');
    expect(bytes).toContain(PERSIST_REDACTED_LABEL);
    expect(scanTextForSecrets(bytes)).toEqual([]);
  }, 120_000);
});
