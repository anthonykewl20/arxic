import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Workbench } from '../workbench';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const ROW = 'inv:page:GET:7db4b8bf2d28';

async function openCampaignWorkbench() {
  const repo = await makeRepository('reference-auth-app');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-campaign-recurrence-'));
  cleanups.push(
    () => rm(repo.root, { recursive: true, force: true }),
    () => rm(directory, { recursive: true, force: true }),
  );
  const wb = await Workbench.open(directory, [repo.root]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({
    name: 'Recurring campaign',
    folder: repo.root,
    origin: 'http://127.0.0.1:1',
    execution: { model: 'gpt-4o-mini', frameworks: ['nextjs'], domains: ['authentication'] },
  });
  const discovery = wb.enqueue(project.id, 'discovery');
  await wb.idle();
  return { wb, project, discovery };
}

it('rejects a non-five-field campaign recurrence cron before any campaign child is inserted', async () => {
  const { wb, project, discovery } = await openCampaignWorkbench();
  await expect(
    wb.enqueueCampaign(project.id, {
      discoveryRunId: discovery.id,
      inventoryRowIds: [ROW],
      cron: 'every minute please',
    }),
  ).rejects.toThrow('five-field cron');
  expect(wb.store.runs()).toHaveLength(1);
}, 60_000);

it('re-fires a recurring campaign at its next cron slot as a fresh execution with its own denominator', async () => {
  const { wb, project, discovery } = await openCampaignWorkbench();
  const first = await wb.enqueueCampaign(project.id, {
    discoveryRunId: discovery.id,
    inventoryRowIds: [ROW],
    cron: '*/1 * * * *',
  });
  await wb.idle();
  expect(first.runIds.length).toBeGreaterThan(0);
  const originalRunIds = [...first.runIds];

  const due = new Date(
    wb.store.campaign(first.id)!.nextFireAt ?? 'missing nextFireAt',
  );
  // A second tick at the same instant must coalesce: one firing per slot.
  wb.tick(due);
  wb.tick(due);
  const campaigns = wb.store.campaigns().filter((item) => item.projectId === project.id);
  expect(campaigns).toHaveLength(2);
  const fired = campaigns.find((item) => item.id !== first.id)!;
  expect(fired.sourceCommit).toBe(first.sourceCommit);
  expect(fired.rows.map((row) => row.inventoryRowId)).toEqual(
    first.rows.map((row) => row.inventoryRowId),
  );
  expect(fired.runIds.length).toBeGreaterThan(0);
  expect(fired.runIds).not.toEqual(originalRunIds);
  expect(wb.store.campaign(first.id)!.runIds).toEqual(originalRunIds);
  await wb.idle();
}, 120_000);
