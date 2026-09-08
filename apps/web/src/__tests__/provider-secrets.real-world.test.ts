import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { modelEnvironment } from '../model-connections';
import { startWorkbench } from '../server';
import { Workbench } from '../workbench';

type App = Awaited<ReturnType<typeof startWorkbench>>;
const token = 'provider-secrets-test-token-at-least-32-characters';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

async function openWorkbench(stateDirectory: string): Promise<App> {
  const app = await startWorkbench({
    roots: [stateDirectory],
    stateDirectory,
    port: 0,
    adminToken: token,
  });
  cleanup.push(() => app.close());
  return app;
}
async function signIn(app: App): Promise<string> {
  const session = await fetch(app.origin + '/api/session', {
    method: 'POST',
    headers: { origin: app.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  expect(session.status).toBe(200);
  return session.headers.get('set-cookie')!.split(';')[0];
}
async function connections(app: App, cookie: string) {
  const state = await fetch(app.origin + '/api/state', { headers: { cookie } });
  expect(state.status).toBe(200);
  const text = await state.text();
  const parsed = JSON.parse(text) as {
    modelConnections: Array<{ id: string; secret: string; models: string[] }>;
  };
  return { text, modelConnections: parsed.modelConnections };
}
const secretCall = (app: App, cookie: string, method: 'POST' | 'DELETE', body: unknown) =>
  fetch(app.origin + '/api/provider-secrets', {
    method,
    headers: { cookie, origin: app.origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

it('connects and removes an HTTP provider credential from the dashboard without leaking it', async () => {
  const state = await mkdtemp(join(tmpdir(), 'arxic-provider-secrets-'));
  cleanup.push(() => rm(state, { recursive: true, force: true }));
  const app = await openWorkbench(state);
  const cookie = await signIn(app);
  const before = await connections(app, cookie);
  expect(before.modelConnections.find((item) => item.id === 'glm-coding')?.secret).toBe('missing');

  expect(
    (
      await secretCall(app, cookie, 'POST', {
        connection: 'glm-coding',
        value: 'zai-plan-key-not-for-display',
      })
    ).status,
  ).toBe(201);
  const after = await connections(app, cookie);
  expect(after.modelConnections.find((item) => item.id === 'glm-coding')?.secret).toBe(
    'configured',
  );
  expect(after.text).not.toContain('zai-plan-key-not-for-display');

  await app.close();
  cleanup.pop();
  const restarted = await openWorkbench(state);
  const persisted = await connections(restarted, await signIn(restarted));
  expect(persisted.modelConnections.find((item) => item.id === 'glm-coding')?.secret).toBe(
    'configured',
  );

  expect(
    (await secretCall(restarted, await signIn(restarted), 'DELETE', { connection: 'glm-coding' }))
      .status,
  ).toBe(200);
  const removed = await connections(restarted, await signIn(restarted));
  expect(removed.modelConnections.find((item) => item.id === 'glm-coding')?.secret).toBe('missing');
}, 60_000);

it('rejects unauthenticated, unknown, credential-less and malformed secret requests', async () => {
  const state = await mkdtemp(join(tmpdir(), 'arxic-provider-secrets-sad-'));
  cleanup.push(() => rm(state, { recursive: true, force: true }));
  const app = await openWorkbench(state);
  const cookie = await signIn(app);
  expect(
    (
      await fetch(app.origin + '/api/provider-secrets', {
        method: 'POST',
        headers: { origin: app.origin, 'content-type': 'application/json' },
        body: JSON.stringify({ connection: 'glm-coding', value: 'x'.repeat(40) }),
      })
    ).status,
  ).toBe(401);
  for (const body of [
    {},
    { value: 'x'.repeat(40) },
    { connection: 'does-not-exist', value: 'x'.repeat(40) },
    { connection: 'claude-account', value: 'x'.repeat(40) },
    { connection: 'glm-coding' },
    { connection: 'glm-coding', value: '   ' },
    { connection: 'glm-coding', value: 'x'.repeat(5001) },
    { connection: 'glm-coding', value: 42 },
  ])
    expect((await secretCall(app, cookie, 'POST', body)).status).toBe(400);
  expect((await secretCall(app, cookie, 'DELETE', { connection: 'does-not-exist' })).status).toBe(
    400,
  );
  const untouched = await connections(app, cookie);
  expect(untouched.modelConnections.find((item) => item.id === 'glm-coding')?.secret).toBe(
    'missing',
  );
});

it('discovers a real local provider catalog through the stored credential only', async () => {
  const observed: Array<string | undefined> = [];
  const provider = createServer((request, response) => {
    observed.push(request.headers.authorization);
    if (request.url === '/models') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'local-model-a' }, { id: 'local-model-b' }] }));
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>((resolve) => provider.close(() => resolve())));
  const address = provider.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;
  vi.stubEnv(
    'ARXIC_MODEL_CONNECTIONS',
    JSON.stringify([
      {
        id: 'local-keyed',
        label: 'Local keyed provider',
        transport: 'http',
        baseUrl,
        credentialRef: 'ARXIC_SECRET_LOCAL_KEYED',
        billing: 'api',
        models: [],
      },
    ]),
  );
  const state = await mkdtemp(join(tmpdir(), 'arxic-provider-secrets-catalog-'));
  cleanup.push(() => rm(state, { recursive: true, force: true }));
  const app = await openWorkbench(state);
  const cookie = await signIn(app);

  const denied = await fetch(app.origin + '/api/model-connections/local-keyed/refresh', {
    method: 'POST',
    headers: { cookie, origin: app.origin, 'content-type': 'application/json' },
  });
  expect(denied.status).toBe(200);
  const deniedState = (await denied.json()) as {
    modelConnections: Array<{ id: string; catalog: { error: string | null } }>;
  };
  expect(
    deniedState.modelConnections.find((item) => item.id === 'local-keyed')?.catalog.error,
  ).toBe('The provider credential is not configured on this server');

  expect(
    (
      await secretCall(app, cookie, 'POST', {
        connection: 'local-keyed',
        value: 'local-bearer-secret',
      })
    ).status,
  ).toBe(201);
  const refreshed = await fetch(app.origin + '/api/model-connections/local-keyed/refresh', {
    method: 'POST',
    headers: { cookie, origin: app.origin, 'content-type': 'application/json' },
  });
  expect(refreshed.status).toBe(200);
  const refreshedState = (await refreshed.json()) as {
    modelConnections: Array<{ id: string; models: string[]; catalog: { status: string } }>;
  };
  const local = refreshedState.modelConnections.find((item) => item.id === 'local-keyed');
  expect(local?.models).toEqual(['local-model-a', 'local-model-b']);
  expect(local?.catalog.status).toBe('ready');
  expect(observed).toContain('Bearer local-bearer-secret');
  const text = JSON.stringify(refreshedState);
  expect(text).not.toContain('local-bearer-secret');
}, 60_000);

it('resolves a stored credential into the job model environment', async () => {
  const state = await mkdtemp(join(tmpdir(), 'arxic-provider-secrets-jobs-'));
  cleanup.push(() => rm(state, { recursive: true, force: true }));
  const workbench = await Workbench.open(join(state, 'state'), [state]);
  cleanup.push(() => workbench.close());
  await workbench.saveProviderSecret({ connection: 'glm-coding', value: 'zai-key-for-jobs' });
  const env = modelEnvironment('glm-coding', 'glm-4.7', '', workbench.effectiveEnv());
  expect(env.ARXIC_MODEL_API_KEY).toBe('zai-key-for-jobs');
  expect(env.ARXIC_MODEL_BASE_URL).toBe('https://api.z.ai/api/coding/paas/v4');
  expect(env.ARXIC_MODEL_BILLING_MODE).toBe('subscription');
});
