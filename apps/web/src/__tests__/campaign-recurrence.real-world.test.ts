import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  return { wb, project, discovery, repo };
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
  // Capture the slot before the real engine run: the Workbench's own background
  // tick may legitimately fire it while this test idles, and must stay the
  // only firing for that slot either way.
  const due = new Date(wb.store.campaign(first.id)!.nextFireAt!);
  await wb.idle();
  expect(first.runIds.length).toBeGreaterThan(0);
  const originalRunIds = [...first.runIds];

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

it('stops the recurring schedule when a fired run is refused for source drift', async () => {
  const { wb, project, discovery, repo } = await openCampaignWorkbench();
  // Yearly slots are unreachable by the Workbench's 1s background ticker, so the
  // journey — not wall-clock luck — decides when the drift fire happens.
  const first = await wb.enqueueCampaign(project.id, {
    discoveryRunId: discovery.id,
    inventoryRowIds: [ROW],
    cron: '0 0 1 1 *',
  });
  await wb.idle();

  // The source moves past the campaign's discovery binding (any dirty state
  // makes the existing workflow-scope guard refuse the run).
  await writeFile(join(repo.root, 'drift.txt'), 'dirty after discovery');

  wb.tick(new Date(wb.store.campaign(first.id)!.nextFireAt!));
  await wb.idle();
  const firedRun = wb.store
    .campaigns()
    .find((item) => item.id !== first.id && item.projectId === project.id)!
    .runIds.map((runId) => wb.store.run(runId)!)[0];
  expect(firedRun.result?.summary).toContain('Source changed since campaign discovery');

  // The schedule stops with an audited diagnostic instead of firing again.
  const stopped = wb.store.campaign(first.id)!;
  expect(stopped.nextFireAt).toBeNull();
  expect(
    wb.store.auditLog().some((entry) => entry.action === 'campaign.schedule-drift-stopped'),
  ).toBe(true);

  // No further slot fires after the stop.
  wb.tick(new Date(Date.now() + 3_600_000));
  expect(wb.store.campaigns().filter((item) => item.projectId === project.id)).toHaveLength(2);
}, 120_000);
