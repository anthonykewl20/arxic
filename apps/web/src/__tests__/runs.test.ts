import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { Workbench } from '../workbench';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it('records missing AI configuration as blocked and refuses overlapping server instances', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arxic-web-run-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const workbench = await Workbench.open(join(root, 'state'), [root]);
  cleanups.push(() => workbench.close());
  await expect(Workbench.open(join(root, 'state'), [root])).rejects.toThrow('already running');
  const project = await workbench.saveProject({ name: 'Missing prerequisites', folder: root });
  const run = workbench.enqueue(project.id, 'agent');
  await workbench.idle();
  expect(workbench.store.run(run.id)).toMatchObject({
    state: 'blocked',
    result: { outcome: 'blocked' },
  });
});

it('discovers real Next.js routes, persists history, and schedules one job per due slot', async () => {
  const repo = await makeRepository('reference-auth-app');
  const state = await mkdtemp(join(tmpdir(), 'arxic-web-state-'));
  cleanups.push(
    () => rm(repo.root, { recursive: true, force: true }),
    () => rm(state, { recursive: true, force: true }),
  );
  const workbench = await Workbench.open(state, [repo.root]);
  cleanups.push(() => workbench.close());
  const project = await workbench.saveProject({
    name: 'Reference app',
    folder: repo.root,
    cron: '0 9 * * *',
    paused: false,
  });
  const run = workbench.enqueue(project.id, 'discovery');
  await workbench.idle();
  const result = workbench.store.run(run.id);
  expect(result?.result).toMatchObject({
    outcome: 'hypothesized',
    inventory: { rows: expect.arrayContaining([expect.objectContaining({ path: '/login' })]) },
  });
  const due = new Date(project.nextRunAt!);
  workbench.tick(due);
  workbench.tick(due);
  expect(workbench.store.runs()).toHaveLength(2);
  await workbench.idle();
  await workbench.close();
  cleanups.pop();
  const resumed = await Workbench.open(state, [repo.root]);
  cleanups.push(() => resumed.close());
  expect(resumed.store.runs()).toHaveLength(2);
  expect(resumed.store.run(run.id)?.result).toEqual(result?.result);
}, 60_000);

it('cancels a job before its child launches and deletes only terminal non-baseline records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-cancel-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const wb = await Workbench.open(join(directory, 'state'), [directory]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({ name: 'Cancelled project', folder: directory });
  const run = wb.enqueue(project.id, 'discovery');
  await expect(wb.deleteRun(run.id)).rejects.toThrow('Active runs');
  await wb.cancel(run.id);
  await wb.idle();
  expect(wb.store.run(run.id)).toMatchObject({
    state: 'cancelled',
    result: { outcome: 'blocked', summary: 'Cancelled by administrator' },
  });
  await wb.deleteRun(run.id);
  expect(wb.store.run(run.id)).toBeUndefined();
});

it('cancels an actively navigating Chromium job and preserves the administrator cancellation result', async () => {
  let signal: () => void = () => undefined;
  const visited = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const target = createServer(() => signal());
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => {
    target.closeAllConnections();
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-active-cancel-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const wb = await Workbench.open(join(directory, 'state'), [directory]);
  cleanups.push(() => wb.close());
  const port = (target.address() as { port: number }).port;
  const project = await wb.saveProject({
    name: 'Interrupted navigation',
    folder: directory,
    origin: `http://127.0.0.1:${port}`,
    captureConsent: true,
  });
  const run = wb.enqueue(project.id, 'visual');
  await visited;
  await wb.cancel(run.id);
  await wb.idle();
  expect(wb.store.run(run.id)).toMatchObject({
    state: 'cancelled',
    result: { summary: 'Cancelled by administrator' },
  });
}, 30_000);
