import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { Workbench } from '../workbench';
import { campaignRows } from '../campaigns';
import type { DomainInventory } from '@arxic/domain-inventory';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';

const execute = promisify(execFile);

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const ROW = 'inv:page:GET:7db4b8bf2d28';

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'Arxic Test',
  GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
  GIT_COMMITTER_NAME: 'Arxic Test',
  GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
};

const git = (cwd: string, ...args: string[]) =>
  execute('git', args, { cwd, env: { ...process.env, ...GIT_IDENTITY } });

async function openCampaignWorkbench() {
  const repo = await makeRepository('reference-auth-app');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-drift-revalidate-'));
  cleanups.push(
    () => rm(repo.root, { recursive: true, force: true }),
    () => rm(directory, { recursive: true, force: true }),
  );
  const wb = await Workbench.open(directory, [repo.root]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({
    name: 'Drift revalidated campaign',
    folder: repo.root,
    origin: 'http://127.0.0.1:1',
    execution: { model: 'gpt-4o-mini', frameworks: ['nextjs'], domains: ['authentication'] },
  });
  const discovery = wb.enqueue(project.id, 'discovery');
  await wb.idle();
  const inventory = wb.store.run(discovery.id)?.result?.inventory as DomainInventory | undefined;
  if (!inventory) throw new Error('discovery produced no inventory');
  const rows = campaignRows(inventory);
  if (!rows.some((row) => row.inventoryRowId === ROW))
    throw new Error('selected row is missing from the discovery inventory');
  const campaign = await wb.enqueueCampaign(project.id, {
    discoveryRunId: discovery.id,
    inventoryRowIds: [ROW],
    cron: '0 0 1 1 *',
  });
  await wb.idle();
  // Recurring fires create runs under NEW fired-campaign ids, so the doomed-run
  // counter is scoped to the campaign's selected row: creation adds one run,
  // every fire adds exactly one more.
  const rowRuns = () => wb.store.runs().filter((run) => run.workflowScope?.inventoryRowId === ROW);
  const driftStops = () =>
    wb.store
      .auditLog()
      .filter(
        (entry) =>
          entry.action === 'campaign.schedule-drift-stopped' && entry.subject === campaign.id,
      );
  return { wb, repo, project, campaign, rowRuns, driftStops };
}

it('stops a commit-drifted recurring campaign at the fire boundary with zero doomed runs', async () => {
  const { wb, repo, project, campaign, rowRuns, driftStops } = await openCampaignWorkbench();
  const afterCreation = rowRuns().length;
  expect(afterCreation).toBeGreaterThan(0);

  // Positive control on the CLEAN source: the due slot fires exactly one run.
  const slot1 = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  wb.tick(slot1);
  await wb.idle();
  expect(rowRuns()).toHaveLength(afterCreation + 1);

  // REAL drift between fires: a real git commit moves HEAD past the pin.
  await writeFile(join(repo.root, 'drift-commit.txt'), 'committed drift between fires\n');
  await git(repo.root, 'add', '-A');
  await git(repo.root, 'commit', '-m', 'drift after first fire');

  // Yearly slots are unreachable by the Workbench's 1s background ticker, so the
  // journey — not wall-clock luck — decides when the guarded fire happens.
  const slot2 = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  await wb.guardDueCampaigns(slot2);
  wb.tick(slot2);
  await wb.idle();

  expect(rowRuns()).toHaveLength(afterCreation + 1);
  expect(wb.store.campaign(campaign.id)?.nextFireAt).toBeNull();
  expect(driftStops()).toHaveLength(1);
  const projectCampaigns = wb.store.campaigns().filter((item) => item.projectId === project.id);
  expect(projectCampaigns).toHaveLength(2);
  expect(wb.store.runs().filter((run) => ['queued', 'running'].includes(run.state))).toHaveLength(
    0,
  );
}, 240_000);

it('still fires a clean-source recurring campaign after the per-fire guard runs', async () => {
  const { wb, project, campaign, rowRuns, driftStops } = await openCampaignWorkbench();
  const afterCreation = rowRuns().length;

  const slot1 = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  wb.tick(slot1);
  await wb.idle();
  expect(rowRuns()).toHaveLength(afterCreation + 1);

  // No drift: the guard must not stop the armed schedule.
  const slot2 = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  await wb.guardDueCampaigns(slot2);
  wb.tick(slot2);
  await wb.idle();

  expect(rowRuns()).toHaveLength(afterCreation + 2);
  expect(wb.store.campaign(campaign.id)?.nextFireAt).not.toBeNull();
  expect(driftStops()).toHaveLength(0);
  expect(
    wb.store
      .auditLog()
      .some(
        (entry) =>
          entry.action === 'campaign.schedule-drift-stopped' && entry.subject === campaign.id,
      ),
  ).toBe(false);
  // Source campaign plus one fired campaign per clean fire.
  expect(wb.store.campaigns().filter((item) => item.projectId === project.id)).toHaveLength(3);
}, 240_000);

it('stops a dirty-tree recurring campaign at the fire boundary with zero doomed runs', async () => {
  const { wb, repo, project, campaign, rowRuns, driftStops } = await openCampaignWorkbench();
  const afterCreation = rowRuns().length;

  const slot1 = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  wb.tick(slot1);
  await wb.idle();
  expect(rowRuns()).toHaveLength(afterCreation + 1);

  // Dirty-tree drift: an untracked file, never committed.
  await writeFile(join(repo.root, 'drift-dirty.txt'), 'uncommitted drift between fires\n');

  const slot2 = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  await wb.guardDueCampaigns(slot2);
  wb.tick(slot2);
  await wb.idle();

  expect(rowRuns()).toHaveLength(afterCreation + 1);
  expect(wb.store.campaign(campaign.id)?.nextFireAt).toBeNull();
  expect(driftStops()).toHaveLength(1);
  expect(wb.store.campaigns().filter((item) => item.projectId === project.id)).toHaveLength(2);
  expect(wb.store.runs().filter((run) => ['queued', 'running'].includes(run.state))).toHaveLength(
    0,
  );
}, 240_000);
