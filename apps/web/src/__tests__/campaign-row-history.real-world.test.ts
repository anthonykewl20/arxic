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
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-campaign-row-history-'));
  cleanups.push(
    () => rm(repo.root, { recursive: true, force: true }),
    () => rm(directory, { recursive: true, force: true }),
  );
  const wb = await Workbench.open(directory, [repo.root]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({
    name: 'Row history campaign',
    folder: repo.root,
    origin: 'http://127.0.0.1:1',
    execution: { model: 'gpt-4o-mini', frameworks: ['nextjs'], domains: ['authentication'] },
  });
  const discovery = wb.enqueue(project.id, 'discovery');
  await wb.idle();
  return { wb, project, discovery };
}

it('unions every prior execution of a row into its workflow history across recurring fires', async () => {
  const { wb, project, discovery } = await openCampaignWorkbench();
  // Yearly slots are unreachable by the Workbench's 1s background ticker, so
  // explicit ticks — not wall-clock luck — decide how many fires happen.
  const first = await wb.enqueueCampaign(project.id, {
    discoveryRunId: discovery.id,
    inventoryRowIds: [ROW],
    cron: '0 0 1 1 *',
  });
  const slot = new Date(wb.store.campaign(first.id)!.nextFireAt!);
  await wb.idle();
  // Two ticks at the same slot coalesce into a single firing.
  wb.tick(slot);
  wb.tick(slot);
  await wb.idle();
  // A second, later slot: the row has now been executed by the original
  // campaign and two recurring fires.
  wb.tick(new Date(wb.store.campaign(first.id)!.nextFireAt!));
  await wb.idle();

  const campaigns = wb.store.campaigns().filter((item) => item.projectId === project.id);
  expect(campaigns).toHaveLength(3);
  const ownRuns = wb.store.runs().filter((run) => run.workflowScope?.campaignId === first.id);
  const rowRuns = wb.store.runs().filter((run) => run.workflowScope?.inventoryRowId === ROW);
  expect(ownRuns).toHaveLength(1);
  expect(rowRuns).toHaveLength(3);

  // The original campaign's view unions all three executions for the row —
  // not just its own single selected run.
  const view = wb.campaign(first.id);
  const history = view.workflows[0].history;
  expect(history).toBeDefined();
  expect(history!.executions).toBe(3);
  const bucketSum =
    history!.verified +
    history!.contradicted +
    history!.blocked +
    history!.uncovered +
    history!.pending;
  expect(bucketSum).toBe(3);
  const expectedVerified = rowRuns.filter((run) => run.result?.outcome === 'verified').length;
  expect(history!.verified).toBe(expectedVerified);

  // A fire re-executes the campaign's selected rows, not the whole discovery.
  const fired = campaigns.find((item) => item.id !== first.id)!;
  expect(fired.runIds).toHaveLength(1);
  // A fired campaign's view shows the same union, not only its own run.
  expect(wb.campaign(fired.id).workflows[0].history!.executions).toBe(3);
}, 180_000);
