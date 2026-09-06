import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer, request as proxyRequest } from 'node:http';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import type { Run } from '../types';
import { startWorkbench } from './workbench-runtime';

it('recovers failed deletion across server restart without losing real captures or baseline approval', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'packed-restart');
  const directory = await mkdtemp(join(tmpdir(), 'web-restart-'));
  const options = {
    roots: [root],
    stateDirectory: directory,
    port: 0,
    adminToken: 'restart-public-seam-test-token-32-characters',
  };
  let releaseTarget = () => {};
  let proxy: ReturnType<typeof createServer> | undefined;
  let app = await startWorkbench(options);
  let cookie = '';
  async function request(path: string, method = 'GET', body?: unknown) {
    return fetch(app.origin + path, {
      method,
      headers: { cookie, origin: app.origin, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function login() {
    const response = await request('/api/session', 'POST', { token: options.adminToken });
    expect(response.status).toBe(200);
    cookie = response.headers.get('set-cookie')!.split(';')[0];
  }
  async function capture(project: string): Promise<Run> {
    const response = await request(`/api/projects/${project}/runs`, 'POST', { mode: 'visual' });
    expect(response.status).toBe(202);
    const queued = (await response.json()) as Run;
    let run: Run = queued;
    await expect
      .poll(
        async () => {
          run = (await (await request(`/api/runs/${queued.id}`)).json()) as Run;
          return run.state;
        },
        { timeout: 30_000 },
      )
      .toBe('completed');
    expect(run.result?.captures?.length).toBeGreaterThan(0);
    return run;
  }
  try {
    await login();
    const created = await request('/api/projects', 'POST', {
      name: 'Restart reference',
      folder: join(root, 'test-fixtures/vulnerable-auth-app'),
      origin: target.origin,
      captureConsent: true,
      viewports: [{ width: 800, height: 600 }],
    });
    expect(created.status).toBe(201);
    const project = await created.json();
    const baseline = await capture(project.id);
    const image = baseline.result!.captures![0];
    expect(
      (await request(`/api/runs/${baseline.id}/baselines`, 'POST', { captureId: image.id })).status,
    ).toBe(200);
    const artifactPath = `/api/runs/${baseline.id}/artifacts/${image.file}`;
    const original = Buffer.from(await (await request(artifactPath)).arrayBuffer());
    const disposable = await capture(project.id);
    expect(disposable.result!.captures![0].status).toBe('unchanged');
    // Real filesystem failure at the deletion boundary; no fabricated run records.
    await rename(join(directory, 'runs'), join(directory, 'runs-backup'));
    await writeFile(join(directory, 'runs'), 'unavailable storage');
    const failed = await request(`/api/runs/${disposable.id}`, 'DELETE', {});
    expect(failed.status).toBe(409);
    expect(await failed.json()).toEqual({
      error: 'Evidence cleanup failed; check storage and retry',
    });
    expect(await (await request('/api/retention')).json()).toMatchObject({ pendingDeletions: 1 });
    await rm(join(directory, 'runs'));
    await rename(join(directory, 'runs-backup'), join(directory, 'runs'));
    await app.close();
    app = await startWorkbench(options);
    expect((await request('/api/state')).status).toBe(401);
    await login();
    expect(await (await request('/api/retention')).json()).toMatchObject({ pendingDeletions: 0 });
    expect((await request(`/api/runs/${disposable.id}`)).status).toBe(404);
    expect(await (await request(`/api/runs/${baseline.id}`)).json()).toEqual(baseline);
    expect(Buffer.from(await (await request(artifactPath)).arrayBuffer()).equals(original)).toBe(
      true,
    );
    expect((await capture(project.id)).result!.captures![0].status).toBe('unchanged');
    // Hold the real target at a network boundary so one run is interrupted and another queued.
    const released = new Promise<void>((done) => {
      releaseTarget = done;
    });
    proxy = createServer((incoming, outgoing) => {
      void released.then(() => {
        if (outgoing.destroyed) return;
        const upstream = proxyRequest(
          new URL(incoming.url ?? '/', target.origin),
          {
            method: incoming.method,
            headers: { ...incoming.headers, host: new URL(target.origin).host },
          },
          (response) => {
            outgoing.writeHead(response.statusCode ?? 502, response.headers);
            response.pipe(outgoing);
          },
        );
        upstream.on('error', () => outgoing.destroy());
        incoming.pipe(upstream);
      });
    });
    await new Promise<void>((done) => proxy!.listen(0, '127.0.0.1', done));
    const proxyOrigin = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
    const slowProject = await (
      await request('/api/projects', 'POST', {
        name: 'Interrupted reference',
        folder: project.folder,
        origin: proxyOrigin,
        captureConsent: true,
        viewports: [{ width: 800, height: 600 }],
      })
    ).json();
    const interrupted = await (
      await request(`/api/projects/${slowProject.id}/runs`, 'POST', { mode: 'visual' })
    ).json();
    await expect
      .poll(async () => (await (await request(`/api/runs/${interrupted.id}`)).json()).state)
      .toBe('running');
    const queued = await (
      await request(`/api/projects/${project.id}/runs`, 'POST', { mode: 'visual' })
    ).json();
    expect(queued.state).toBe('queued');
    await app.close();
    releaseTarget();
    app = await startWorkbench(options);
    await login();
    expect(await (await request(`/api/runs/${interrupted.id}`)).json()).toMatchObject({
      state: 'blocked',
      result: { outcome: 'blocked' },
    });
    await expect
      .poll(async () => (await (await request(`/api/runs/${queued.id}`)).json()).state, {
        timeout: 30_000,
      })
      .toBe('completed');
    expect((await (await request(`/api/runs/${queued.id}`)).json()).result.captures[0].status).toBe(
      'unchanged',
    );
  } finally {
    releaseTarget();
    await app.close();
    if (proxy) {
      proxy.closeAllConnections();
      await new Promise<void>((done) => proxy!.close(() => done()));
    }
    await stopApp(target.child);
    await rm(directory, { recursive: true, force: true });
    await rm(target.runtimeDirectory, { recursive: true, force: true });
  }
}, 120_000);
