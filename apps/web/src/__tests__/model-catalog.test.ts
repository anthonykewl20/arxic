import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { discoverHttpModels } from '../model-catalog';

it('discovers the configured server default and invalidates its stale catalog on account changes', async () => {
  const { refreshModelCatalog, modelConnections } = await import('../model-connections');
  let failing = false;
  let revision = 1;
  const server = createServer((request, response) => {
    expect(request.url).toBe('/v1/models');
    expect(request.headers.authorization).toBe('Bearer default-catalog-secret');
    if (failing) return response.writeHead(503).end('private-provider-error');
    response.end(JSON.stringify({ data: [{ id: `provider/default-${revision}` }] }));
  }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const env = {
      ARXIC_MODEL_PROVIDER: 'http',
      ARXIC_MODEL_BASE_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
      ARXIC_MODEL_API_KEY: 'default-catalog-secret',
    };
    failing = true;
    await refreshModelCatalog('', env);
    expect(modelConnections(env)[0]).toMatchObject({
      models: [],
      catalog: { status: 'error', error: 'Model discovery failed (HTTP 503)' },
    });
    failing = false;
    await refreshModelCatalog('', env);
    expect(modelConnections(env)[0]).toMatchObject({
      models: ['provider/default-1'],
      catalog: { status: 'ready' },
    });
    revision = 2;
    await refreshModelCatalog('', env);
    expect(modelConnections(env)[0].models).toEqual(['provider/default-2']);
    failing = true;
    await refreshModelCatalog('', env);
    expect(modelConnections(env)[0]).toMatchObject({
      models: ['provider/default-2'],
      catalog: { status: 'error' },
    });
    expect(modelConnections({ ...env, ARXIC_MODEL_API_KEY: 'new-account' })[0]).toMatchObject({
      models: [],
      catalog: { status: 'unfetched' },
    });
    expect(JSON.stringify(modelConnections(env))).not.toContain('default-catalog-secret');
    expect(JSON.stringify(modelConnections(env))).not.toContain('private-provider-error');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('reports provider failures without exposing response bodies or credentials', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(401).end('private-account-detail');
  }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const address = server.address() as { port: number };
    await expect(
      discoverHttpModels(`http://127.0.0.1:${address.port}/v1`, 'secret'),
    ).rejects.toThrow('Model discovery failed (HTTP 401)');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('reads changed provider IDs on every refresh and projects only safe catalog fields', async () => {
  let revision = 1;
  const server = createServer((request, response) => {
    expect(request.url).toBe('/v1/models');
    expect(request.headers.authorization).toBe('Bearer secret');
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        data: [
          {
            id: `vendor/revision-${revision}`,
            secret: 'private',
            pricing: { prompt: '0.000002', completion: '0.000006' },
          },
        ],
      }),
    );
  }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const address = server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}/v1`;
    expect(await discoverHttpModels(url, 'secret')).toEqual([
      { id: 'vendor/revision-1', prices: { promptPerMillion: 2, completionPerMillion: 6 } },
    ]);
    revision = 2;
    expect((await discoverHttpModels(url, 'secret')).map((item) => item.id)).toEqual([
      'vendor/revision-2',
    ]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('marks failed refreshes stale and invalidates cached models when the credential changes', async () => {
  const { refreshModelCatalog, modelConnections, modelEnvironment } =
    await import('../model-connections');
  let failing = false;
  const server = createServer((_request, response) => {
    if (failing) return response.writeHead(503).end('private outage details');
    response.end(
      JSON.stringify({
        data: [
          { id: 'provider/context[1m]', pricing: { prompt: '0.000001', completion: '0.000003' } },
        ],
      }),
    );
  }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const address = server.address() as { port: number };
    const env = {
      ARXIC_MODEL_CONNECTIONS: JSON.stringify([
        {
          id: 'refresh-test',
          label: 'Refresh test',
          transport: 'http',
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          credentialRef: 'ARXIC_SECRET_CATALOG',
          models: [],
        },
      ]),
      ARXIC_SECRET_CATALOG: 'first-key',
    };
    await refreshModelCatalog('refresh-test', env);
    const first = modelConnections(env).find((item) => item.id === 'refresh-test')!;
    expect(first.models).toEqual(['provider/context[1m]']);
    expect(first).toMatchObject({ catalog: { status: 'ready' } });
    expect(
      modelEnvironment('refresh-test', 'provider/context[1m]', '', env).ARXIC_MODEL_PRICES,
    ).toBe('{"promptPerMillion":1,"completionPerMillion":3}');
    failing = true;
    await refreshModelCatalog('refresh-test', env);
    expect(modelConnections(env).find((item) => item.id === 'refresh-test')).toMatchObject({
      models: first.models,
      catalog: {
        status: 'error',
        fetchedAt: first.catalog?.fetchedAt,
        error: 'Model discovery failed (HTTP 503)',
      },
    });
    expect(
      modelConnections({ ...env, ARXIC_SECRET_CATALOG: 'different-account' }).find(
        (item) => item.id === 'refresh-test',
      ),
    ).toMatchObject({ models: [], catalog: { status: 'unfetched' } });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('does not forward credentials through redirects and rejects oversized or malformed responses', async () => {
  let requestsAtRedirectTarget = 0;
  const target = createServer((_request, response) => {
    requestsAtRedirectTarget++;
    response.end('{"data":[]}');
  }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => target.once('listening', resolve));
  const targetAddress = target.address() as { port: number };
  const provider = createServer((request, response) => {
    if (request.url === '/redirect/models')
      return response
        .writeHead(302, { Location: `http://127.0.0.1:${targetAddress.port}/models` })
        .end();
    if (request.url === '/oversize/models') return response.end('x'.repeat(4 * 1024 * 1024 + 1));
    response.end('not-json');
  }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => provider.once('listening', resolve));
  try {
    const address = provider.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    await expect(discoverHttpModels(`${base}/redirect`, 'private-credential')).rejects.toThrow();
    expect(requestsAtRedirectTarget).toBe(0);
    await expect(discoverHttpModels(`${base}/oversize`)).rejects.toThrow('response limit');
    await expect(discoverHttpModels(`${base}/malformed`)).rejects.toThrow(
      'invalid catalog response',
    );
  } finally {
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    await new Promise<void>((resolve) => target.close(() => resolve()));
  }
});
