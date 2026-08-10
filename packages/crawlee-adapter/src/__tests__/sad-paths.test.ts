import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ARXIC_SURFACE_EXTERNAL_ORIGIN,
  ARXIC_SURFACE_FORM_SUBMIT_BLOCKED,
  ARXIC_SURFACE_FRONTIER_STOP,
  ARXIC_SURFACE_MUTATION_BLOCKED,
  ARXIC_SURFACE_NAVIGATION_FAILED,
  ARXIC_SURFACE_ORIGIN_INVALID,
  ARXIC_SURFACE_PERSONA_SERIALIZED,
  CrawleeSurfaceDiscoverer,
  serializeSurfaceMap,
} from '..';

const digest = 'a'.repeat(64);
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.close();
      await once(server, 'close');
    }),
  );
});

describe('CrawleeSurfaceDiscoverer sad paths', () => {
  it('does not follow an EXTERNAL origin link and reports blocked', async () => {
    let externalRequests = 0;
    const external = await serve(() => {
      externalRequests += 1;
      return '<h1>must not load</h1>';
    });
    const origin = await serve(() => `<title>home</title><a href="${external}/escape">escape</a>`);

    const result = await discoverer().collect({ origin, appBuildDigest: digest });

    expect(externalRequests).toBe(0);
    expect(result.routes).toHaveLength(1);
    expect(result.navigationEdges).toContainEqual({
      from: `${origin}/`,
      to: `${external}/escape`,
      depth: 1,
      status: 'blocked',
      reason: 'external-origin',
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_SURFACE_EXTERNAL_ORIGIN, severity: 'blocked' }),
    );
  }, 60_000);

  it('observes a destructive form but never submits it without approved policy (blocked)', async () => {
    let posts = 0;
    const origin = await serve((request) => {
      if (request.method === 'POST') posts += 1;
      return '<title>danger</title><form action="/delete-account" method="post"><button type="submit">Delete account</button></form>';
    });

    const result = await discoverer().collect({ origin, appBuildDigest: digest });

    expect(posts).toBe(0);
    expect(result.routes[0]?.forms).toEqual([
      expect.objectContaining({
        action: `${origin}/delete-account`,
        method: 'POST',
        destructive: true,
      }),
    ]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_SURFACE_FORM_SUBMIT_BLOCKED, severity: 'blocked' }),
    );
  }, 60_000);

  it('blocks same-origin mutation requests at the network layer', async () => {
    let posts = 0;
    const origin = await serve((request) => {
      if (request.url === '/mutate' && request.method === 'POST') posts += 1;
      return `<title>network mutation</title><script>fetch('/mutate', { method: 'POST' })</script>`;
    });

    const result = await discoverer().collect({
      origin,
      appBuildDigest: digest,
      maxUrls: 1,
      maxDepth: 0,
    });

    expect(posts).toBe(0);
    expect(result.routes).toHaveLength(1);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_SURFACE_MUTATION_BLOCKED, severity: 'blocked' }),
    );
  }, 60_000);

  it('preserves cookies across queued pages while Service Workers use the persistent-context block seam', async () => {
    let cookieOnSecondPage = '';
    const origin = await serve((request, response) => {
      if (request.url === '/') {
        response.setHeader('set-cookie', 'crawl-session=preserved; Path=/; SameSite=Lax');
        return '<a href="/next">next</a>';
      }
      cookieOnSecondPage = request.headers.cookie ?? '';
      return '<title>next</title>';
    });

    const result = await discoverer().collect({ origin, appBuildDigest: digest, maxDepth: 1 });

    expect(cookieOnSecondPage).toContain('crawl-session=preserved');
    expect(result.routes.map((route) => route.path)).toEqual(['/', '/next']);
  }, 60_000);

  it('returns blocked diagnostics for an empty origin without throwing', async () => {
    const adapter = discoverer();

    await expect(adapter.collect({ origin: '', appBuildDigest: digest })).resolves.toBeDefined();
    const result = await adapter.collect({ origin: '', appBuildDigest: digest });
    const events = [];
    for await (const event of adapter.discover({ origin: '' })) events.push(event);

    expect(result.routes).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_SURFACE_ORIGIN_INVALID, severity: 'blocked' }),
    );
    expect(events).toEqual([
      {
        diagnostic: expect.objectContaining({
          code: ARXIC_SURFACE_ORIGIN_INVALID,
          severity: 'blocked',
        }),
      },
    ]);
  });

  it('stops maxUrls and maxDepth frontier growth safely with blocked diagnostics', async () => {
    const origin = await serve((request) => {
      if (request.url === '/') return '<a href="/a">a</a><a href="/b">b</a><a href="/c">c</a>';
      return `<title>${request.url}</title><a href="${request.url}/deep">deep</a>`;
    });
    const adapter = discoverer();

    const urlBound = await adapter.collect({
      origin,
      appBuildDigest: digest,
      maxUrls: 2,
      maxDepth: 5,
    });
    const depthBound = await adapter.collect({
      origin,
      appBuildDigest: digest,
      maxUrls: 10,
      maxDepth: 0,
    });

    expect(urlBound.routes.length).toBeLessThanOrEqual(2);
    expect(urlBound.navigationEdges.some((edge) => edge.reason === 'max-urls')).toBe(true);
    expect(depthBound.routes).toHaveLength(1);
    expect(depthBound.navigationEdges.every((edge) => edge.reason === 'max-depth')).toBe(true);
    expect([...urlBound.diagnostics, ...depthBound.diagnostics]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: ARXIC_SURFACE_FRONTIER_STOP, severity: 'blocked' }),
      ]),
    );
  }, 120_000);

  it('serializes two workflows sharing a mutable persona and reports the concurrent attempt blocked', async () => {
    let active = 0;
    let maximumActive = 0;
    const origin = await serve(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 500));
      active -= 1;
      return '<title>serialized identity</title>';
    });
    const adapter = discoverer();

    const results = await Promise.all([
      adapter.collect({ origin, appBuildDigest: digest, personas: ['mutable-user'] }),
      adapter.collect({ origin, appBuildDigest: digest, personas: ['mutable-user'] }),
    ]);

    expect(maximumActive).toBe(1);
    expect(results.flatMap((result) => result.diagnostics)).toContainEqual(
      expect.objectContaining({ code: ARXIC_SURFACE_PERSONA_SERIALIZED, severity: 'blocked' }),
    );
  }, 120_000);

  it('retries transient navigation failure then gives up within the retry bound as observed, never verified', async () => {
    let attempts = 0;
    const origin = await serve((_request, response) => {
      attempts += 1;
      response.statusCode = 503;
      return '<title>temporarily unavailable</title>';
    });
    const adapter = new CrawleeSurfaceDiscoverer({
      maxRequestRetries: 1,
      navigationTimeoutSecs: 5,
    });

    const result = await adapter.collect({ origin, appBuildDigest: digest, maxUrls: 1 });

    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(attempts).toBeLessThanOrEqual(3);
    expect(result.routes).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: ARXIC_SURFACE_NAVIGATION_FAILED, severity: 'observed' }),
    );
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.severity === ('verified' as never)),
    ).toBe(false);
  }, 60_000);

  it('serializes an identical observed surface map byte-for-byte with fixed runtime inputs', async () => {
    const origin = await serve(() => '<title>stable</title><a href="/next">Next</a>');
    const adapter = discoverer();
    const input = { origin, appBuildDigest: digest, maxUrls: 1 };

    expect(serializeSurfaceMap(await adapter.collect(input))).toBe(
      serializeSurfaceMap(await adapter.collect(input)),
    );
  }, 120_000);

  it('deduplicates navigation edges and serializes concurrent crawls deterministically', async () => {
    const origin = await serve((request) =>
      request.url === '/next'
        ? '<a href="/">Home</a>'
        : '<a href="/next">Next one</a><a href="/next">Next two</a>',
    );
    const adapter = discoverer();
    const input = { origin, appBuildDigest: digest, maxUrls: 4, maxDepth: 2 };

    const first = await adapter.collect(input);
    const observedPairs = first.navigationEdges
      .filter((edge) => edge.status === 'observed')
      .map((edge) => `${edge.from}\0${edge.to}`);

    expect(new Set(observedPairs).size).toBe(observedPairs.length);
    expect(serializeSurfaceMap(first)).toBe(serializeSurfaceMap(await adapter.collect(input)));
  }, 120_000);
});

function discoverer(): CrawleeSurfaceDiscoverer {
  return new CrawleeSurfaceDiscoverer({
    now: () => '2026-08-05T00:00:00.000Z',
    runId: () => 'surface-test-run',
  });
}

type Handler = (
  request: import('node:http').IncomingMessage,
  response: import('node:http').ServerResponse,
) => string | Promise<string> | void;

async function serve(handler: Handler): Promise<string> {
  const server = createServer(async (request, response) => {
    const body = await handler(request, response);
    if (response.destroyed || response.writableEnded) return;
    response.setHeader('content-type', 'text/html');
    response.end(body ?? '');
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate fixture port');
  return `http://127.0.0.1:${address.port}`;
}
