import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { startWorkbench } from '../server';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it('refuses anonymous reads and cross-origin sign-in without exposing state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-http-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const app = await startWorkbench({
    stateDirectory: directory,
    roots: [directory],
    adminToken: 'test-administrator-token-32-characters',
    port: 0,
  });
  cleanups.push(() => app.close());
  expect((await fetch(`${app.origin}/api/state`)).status).toBe(401);
  const refused = await fetch(`${app.origin}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://outside.invalid' },
    body: JSON.stringify({ token: 'test-administrator-token-32-characters' }),
  });
  expect(refused.status).toBe(403);
  expect(await refused.text()).not.toContain('test-administrator');
});

it('rejects projects outside the allow-list, including symlinks, and invalid cron schedules', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-project-'));
  const outside = await mkdtemp(join(tmpdir(), 'arxic-web-outside-'));
  cleanups.push(
    () => rm(directory, { recursive: true, force: true }),
    () => rm(outside, { recursive: true, force: true }),
  );
  await symlink(
    outside,
    join(directory, 'escape'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const app = await startWorkbench({
    stateDirectory: join(directory, 'state'),
    roots: [directory],
    adminToken: 'test-administrator-token-32-characters',
    port: 0,
  });
  cleanups.push(() => app.close());
  const login = await fetch(`${app.origin}/api/session`, {
    method: 'POST',
    headers: { origin: app.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'test-administrator-token-32-characters' }),
  });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const create = (body: unknown) =>
    fetch(`${app.origin}/api/projects`, {
      method: 'POST',
      headers: { cookie, origin: app.origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  for (const folder of [outside, join(directory, 'escape')]) {
    expect((await create({ name: 'Outside', folder })).status).toBe(400);
  }
  expect(
    (await create({ name: 'Invalid schedule', folder: directory, cron: '* * nonsense' })).status,
  ).toBe(400);
});

it('requires same-origin JSON writes, invalidates logout sessions, and serves no anonymous artifacts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-auth-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const app = await startWorkbench({
    stateDirectory: directory,
    roots: [directory],
    adminToken: 'test-administrator-token-32-characters',
    port: 0,
  });
  cleanups.push(() => app.close());
  const login = await fetch(`${app.origin}/api/session`, {
    method: 'POST',
    headers: { origin: app.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'test-administrator-token-32-characters' }),
  });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  expect(login.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
  expect(
    (
      await fetch(`${app.origin}/api/projects`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await fetch(`${app.origin}/api/projects`, {
        method: 'POST',
        headers: { cookie, origin: app.origin, 'content-type': 'text/plain' },
        body: '{}',
      })
    ).status,
  ).toBe(415);
  const state = await (await fetch(`${app.origin}/api/state`, { headers: { cookie } })).json();
  expect(state.version).toBe('0.0.100');
  expect(state.versionLabel).toBe('v0.0.100');
  expect((await fetch(`${app.origin}/api/runs/00000000/artifacts/checkpoint-1.png`)).status).toBe(
    401,
  );
  expect(
    (
      await fetch(`${app.origin}/api/session`, {
        method: 'DELETE',
        headers: { cookie, origin: app.origin, 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
  ).toBe(200);
  expect((await fetch(`${app.origin}/api/state`, { headers: { cookie } })).status).toBe(401);
});
