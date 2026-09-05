import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { discoverHttpModels } from '../model-catalog';

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
