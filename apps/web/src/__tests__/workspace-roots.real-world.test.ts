import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { startWorkbench } from '../server';

const TOKEN = 'test-administrator-token-32-characters';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function open(stateDirectory: string, roots: string[]) {
  const app = await startWorkbench({
    stateDirectory,
    roots,
    adminToken: TOKEN,
    port: 0,
  });
  cleanups.push(() => app.close());
  return app;
}

type App = Awaited<ReturnType<typeof open>>;

async function login(app: App) {
  const response = await fetch(`${app.origin}/api/session`, {
    method: 'POST',
    headers: { origin: app.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ token: TOKEN }),
  });
  return response.headers.get('set-cookie')!.split(';')[0];
}

it('refuses to widen workspace roots without a session or a real absolute folder', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-roots-sad-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const app = await open(join(directory, 'state'), [directory]);
  expect(
    (
      await fetch(`${app.origin}/api/roots`, {
        method: 'POST',
        headers: { origin: app.origin, 'content-type': 'application/json' },
        body: JSON.stringify({ path: directory }),
      })
    ).status,
  ).toBe(401);
  const cookie = await login(app);
  for (const [body, expected] of [
    [{ path: 'relative/path' }, 400],
    [{ path: join(directory, 'missing-folder') }, 400],
    [{}, 400],
  ] as const) {
    const response = await fetch(`${app.origin}/api/roots`, {
      method: 'POST',
      headers: { cookie, origin: app.origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(expected);
  }
}, 30_000);

it('adds a workspace root at runtime, connects a project under it, and persists the root across restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-roots-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const startupRoot = join(directory, 'startup-root');
  await mkdir(startupRoot);
  const app = await open(join(directory, 'state'), [startupRoot]);
  const cookie = await login(app);
  const outside = join(directory, 'mightybox');
  await mkdir(outside, { recursive: true });
  const create = (method: string, body: unknown) =>
    fetch(`${app.origin}/api/roots`, {
      method,
      headers: { cookie, origin: app.origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const refused = await fetch(`${app.origin}/api/projects`, {
    method: 'POST',
    headers: { cookie, origin: app.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Mightybox', folder: outside }),
  });
  expect(refused.status).toBe(400);
  expect(await refused.text()).toContain('Administration');

  expect((await create('POST', { path: outside })).status).toBe(201);
  const state = (await (
    await fetch(`${app.origin}/api/state`, { headers: { cookie } })
  ).json()) as {
    roots: string[];
  };
  expect(state.roots).toContain(outside);

  const connected = await fetch(`${app.origin}/api/projects`, {
    method: 'POST',
    headers: { cookie, origin: app.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Mightybox', folder: outside }),
  });
  expect(connected.status).toBe(201);

  // A root with a connected project cannot be removed; an unused root can.
  const blocked = await create('DELETE', { path: outside });
  expect(blocked.status).toBe(409);
  expect(await blocked.text()).toContain('still uses this workspace root');
  const spare = join(directory, 'spare-root');
  await mkdir(spare);
  expect((await create('POST', { path: spare })).status).toBe(201);
  expect((await create('DELETE', { path: spare })).status).toBe(200);

  // The added root survives a server restart on the same state directory.
  await cleanups.pop()!();
  const restarted = await open(join(directory, 'state'), [startupRoot]);
  const restartedCookie = await login(restarted);
  const resumed = (await (
    await fetch(`${restarted.origin}/api/state`, { headers: { cookie: restartedCookie } })
  ).json()) as { roots: string[] };
  expect(resumed.roots).toContain(outside);
}, 120_000);
