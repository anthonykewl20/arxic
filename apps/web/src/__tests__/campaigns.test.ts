import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Workbench } from '../workbench';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it('rejects a campaign without completed discovery and inserts no partial jobs', async () => {
  const repo = await makeRepository('reference-auth-app');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-campaign-'));
  cleanups.push(
    () => rm(repo.root, { recursive: true, force: true }),
    () => rm(directory, { recursive: true, force: true }),
  );
  const wb = await Workbench.open(directory, [repo.root]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({
    name: 'Reference campaign',
    folder: repo.root,
    origin: 'http://127.0.0.1:1',
    execution: { model: 'gpt-4o-mini', frameworks: ['nextjs'], domains: ['authentication'] },
  });
  await expect(
    wb.enqueueCampaign(project.id, {
      discoveryRunId: 'missing',
      inventoryRowIds: ['inv:page:GET:7db4b8bf2d28'],
    }),
  ).rejects.toThrow('completed discovery');
  expect(wb.store.runs()).toEqual([]);
});

it('refuses invalid selected rows and reserves the whole campaign queue atomically', async () => {
  const repo = await makeRepository('reference-auth-app');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-campaign-policy-'));
  cleanups.push(
    () => rm(repo.root, { recursive: true, force: true }),
    () => rm(directory, { recursive: true, force: true }),
  );
  const wb = await Workbench.open(directory, [repo.root]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({
    name: 'Reference campaign',
    folder: repo.root,
    origin: 'http://127.0.0.1:1',
    execution: { model: 'gpt-4o-mini', frameworks: ['nextjs'], domains: ['authentication'] },
  });
  const discovery = wb.enqueue(project.id, 'discovery');
  await wb.idle();
  const row = 'inv:page:GET:7db4b8bf2d28';
  for (const inventoryRowIds of [
    [],
    [row, row],
    ['inv:page:GET:000000000000'],
    Array.from({ length: 21 }, (_, i) => String(i)),
  ]) {
    await expect(
      wb.enqueueCampaign(project.id, { discoveryRunId: discovery.id, inventoryRowIds }),
    ).rejects.toThrow('selection');
  }
  expect(wb.store.runs()).toHaveLength(1);
  // These are real durable queue entries; cancel them before any engine launch.
  for (let i = 0; i < 19; i++) wb.store.enqueue(project, 'agent');
  await expect(
    wb.enqueueCampaign(project.id, {
      discoveryRunId: discovery.id,
      inventoryRowIds: [row, 'inv:page:GET:17251c2c0bbc'],
    }),
  ).rejects.toThrow('capacity');
  expect(wb.store.runs()).toHaveLength(20);
  for (const run of wb.store.runs()) if (run.state === 'queued') await wb.cancel(run.id);
}, 60_000);

it('refuses changed source and missing guided execution before any campaign child is inserted', async () => {
  const repo = await makeRepository('reference-auth-app');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-campaign-source-'));
  cleanups.push(
    () => rm(repo.root, { recursive: true, force: true }),
    () => rm(directory, { recursive: true, force: true }),
  );
  const wb = await Workbench.open(directory, [repo.root]);
  cleanups.push(() => wb.close());
  const settings = { name: 'Reference campaign', folder: repo.root, origin: 'http://127.0.0.1:1' };
  const project = await wb.saveProject(settings);
  const discovery = wb.enqueue(project.id, 'discovery');
  await wb.idle();
  const selection = {
    discoveryRunId: discovery.id,
    inventoryRowIds: ['inv:page:GET:7db4b8bf2d28'],
  };
  await expect(wb.enqueueCampaign(project.id, selection)).rejects.toThrow('guided');
  await wb.saveProject(
    {
      ...settings,
      execution: { model: 'gpt-4o-mini', frameworks: ['nextjs'], domains: ['authentication'] },
    },
    project.id,
  );
  await writeFile(join(repo.root, 'uncommitted-feature.ts'), 'export const feature = true;');
  await expect(wb.enqueueCampaign(project.id, selection)).rejects.toThrow('Source changed');
  expect(wb.store.runs()).toHaveLength(1);
}, 60_000);

it('persists a complete campaign, cancels its children and protects its evidence after restart', async () => {
  const repo = await makeRepository('reference-auth-app');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-campaign-recovery-'));
  cleanups.push(
    () => rm(repo.root, { recursive: true, force: true }),
    () => rm(directory, { recursive: true, force: true }),
  );
  let wb = await Workbench.open(directory, [repo.root]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({
    name: 'Reference campaign',
    folder: repo.root,
    origin: 'http://127.0.0.1:1',
    execution: { model: 'gpt-4o-mini', frameworks: ['nextjs'], domains: ['authentication'] },
  });
  const discovery = wb.enqueue(project.id, 'discovery');
  await wb.idle();
  const selected = ['inv:page:GET:7db4b8bf2d28', 'inv:page:GET:17251c2c0bbc'];
  const campaign = await wb.enqueueCampaign(project.id, {
    discoveryRunId: discovery.id,
    inventoryRowIds: selected,
  });
  expect(campaign.runIds).toHaveLength(2);
  expect(wb.campaign(campaign.id).counts).toMatchObject({ selected: 2, verified: 0, pending: 2 });
  expect(campaign.rows.length).toBeGreaterThan(2);
  expect(
    campaign.rows
      .filter((row) => row.runId)
      .map((row) => row.inventoryRowId)
      .sort(),
  ).toEqual([...selected].sort());
  await wb.cancelCampaign(campaign.id);
  await wb.idle();
  for (const id of campaign.runIds) {
    expect(wb.store.run(id)?.state).toBe('cancelled');
    await expect(wb.deleteRun(id)).rejects.toThrow('campaign');
  }
  await expect(wb.deleteRun(discovery.id)).rejects.toThrow('campaign');
  await wb.close();
  wb = await Workbench.open(directory, [repo.root]);
  expect(wb.campaign(campaign.id)).toMatchObject({
    state: 'cancelled',
    counts: { selected: 2, verified: 0, blocked: 2, pending: 0 },
  });
  expect(wb.campaign(campaign.id).rows).toEqual(campaign.rows);
}, 60_000);

it('blocks queued campaign work after source changes during a server restart', async () => {
  const repo = await makeRepository('reference-auth-app');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-campaign-stale-'));
  cleanups.push(
    () => rm(repo.root, { recursive: true, force: true }),
    () => rm(directory, { recursive: true, force: true }),
  );
  let wb = await Workbench.open(directory, [repo.root]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({
    name: 'Stale campaign',
    folder: repo.root,
    origin: 'http://127.0.0.1:1',
    execution: { model: 'gpt-4o-mini', frameworks: ['nextjs'], domains: ['authentication'] },
  });
  const discovery = wb.enqueue(project.id, 'discovery');
  await wb.idle();
  const campaign = await wb.enqueueCampaign(project.id, {
    discoveryRunId: discovery.id,
    inventoryRowIds: ['inv:page:GET:7db4b8bf2d28', 'inv:page:GET:17251c2c0bbc'],
  });
  await wb.close();
  await writeFile(join(repo.root, 'changed-after-enqueue.ts'), 'export const changed = true;');
  wb = await Workbench.open(directory, [repo.root]);
  await wb.idle();
  expect(wb.store.run(campaign.runIds[1])?.result).toMatchObject({
    outcome: 'blocked',
    summary: expect.stringContaining('Source changed'),
  });
  expect(wb.campaign(campaign.id).counts).toMatchObject({
    selected: 2,
    verified: 0,
    blocked: 2,
    pending: 0,
  });
}, 60_000);

it('keeps an uncompiled hypothesis uncovered rather than calling it blocked or verified', async () => {
  const { campaignView } = await import('../campaigns');
  const view = campaignView(
    {
      id: 'policy-campaign',
      projectId: 'project',
      projectName: 'Policy proof',
      discoveryRunId: 'discovery',
      sourceCommit: 'a'.repeat(40),
      createdAt: '2026-09-05T00:00:00Z',
      runIds: ['uncompiled'],
      rows: [
        {
          key: 'GET /unsupported-state',
          method: 'GET',
          path: '/unsupported-state',
          disposition: 'extracted',
          reason: '',
          inventoryRowId: 'inv:page:GET:000000000000',
          runId: 'uncompiled',
        },
      ],
    },
    [
      {
        state: 'completed',
        result: { outcome: 'hypothesized', summary: 'No compilable workflow' },
      },
    ],
  );
  expect(view.counts).toMatchObject({
    selected: 1,
    verified: 0,
    blocked: 0,
    uncovered: 1,
    pending: 0,
  });
  expect(view).not.toHaveProperty('outcome');
});

it('cannot delete discovery evidence while a campaign is being created', async () => {
  const repo = await makeRepository('reference-auth-app');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-campaign-delete-race-'));
  cleanups.push(
    () => rm(repo.root, { recursive: true, force: true }),
    () => rm(directory, { recursive: true, force: true }),
  );
  const wb = await Workbench.open(directory, [repo.root]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({
    name: 'Evidence race',
    folder: repo.root,
    origin: 'http://127.0.0.1:1',
    execution: { model: 'gpt-4o-mini', frameworks: ['nextjs'], domains: ['authentication'] },
  });
  const discovery = wb.enqueue(project.id, 'discovery');
  await wb.idle();
  // A real large artifact tree keeps deletion in flight across Git source checks.
  const artifacts = join(directory, 'runs', discovery.id, 'many-artifacts');
  await mkdir(artifacts);
  for (let batch = 0; batch < 100; batch++)
    await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        writeFile(join(artifacts, String(batch * 100 + i)), 'reference artifact'),
      ),
    );
  const [created, deleted] = await Promise.allSettled([
    wb.enqueueCampaign(project.id, {
      discoveryRunId: discovery.id,
      inventoryRowIds: ['inv:page:GET:7db4b8bf2d28'],
    }),
    wb.deleteRun(discovery.id),
  ]);
  expect(created.status === 'fulfilled' && deleted.status === 'fulfilled').toBe(false);
  if (created.status === 'fulfilled') {
    expect(wb.store.run(discovery.id)).toBeDefined();
    await wb.cancelCampaign(created.value.id);
    await wb.idle();
  }
}, 60_000);
