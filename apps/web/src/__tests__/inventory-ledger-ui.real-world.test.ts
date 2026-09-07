import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Workbench } from '../workbench';
import { campaignRows } from '../campaigns';
import type { DomainInventory } from '@arxic/domain-inventory';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';
import { launchDashboardBrowser } from './dashboard-browser';
import { startWorkbench } from './workbench-runtime';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const ROW = 'inv:page:GET:7db4b8bf2d28';

it('shows the cross-campaign execution ledger on inventory rows in the real dashboard', async () => {
  const repo = await makeRepository('reference-auth-app');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-inventory-ledger-'));
  cleanups.push(
    () => rm(repo.root, { recursive: true, force: true }),
    () => rm(directory, { recursive: true, force: true }),
  );
  const wb = await Workbench.open(directory, [repo.root]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({
    name: 'Inventory ledger',
    folder: repo.root,
    origin: 'http://127.0.0.1:1',
    execution: { model: 'gpt-4o-mini', frameworks: ['nextjs'], domains: ['authentication'] },
  });
  const discovery = wb.enqueue(project.id, 'discovery');
  await wb.idle();
  const inventory = wb.store.run(discovery.id)?.result?.inventory as DomainInventory | undefined;
  if (!inventory) throw new Error('discovery produced no inventory');
  const rows = campaignRows(inventory);
  const key = rows.find((row) => row.inventoryRowId === ROW)?.key;
  if (!key) throw new Error('selected row is missing from the discovery inventory');
  const unselectedKey = rows.find((row) => row.inventoryRowId && row.inventoryRowId !== ROW)?.key;
  if (!unselectedKey) throw new Error('discovery has no second selectable row');

  // Yearly slots are unreachable by the Workbench's 1s background ticker, so
  // explicit ticks — not wall-clock luck — decide how many fires happen.
  const first = await wb.enqueueCampaign(project.id, {
    discoveryRunId: discovery.id,
    inventoryRowIds: [ROW],
    cron: '0 0 1 1 *',
  });
  const slot = new Date(wb.store.campaign(first.id)!.nextFireAt!);
  await wb.idle();
  wb.tick(slot);
  await wb.idle();
  wb.tick(new Date(wb.store.campaign(first.id)!.nextFireAt!));
  await wb.idle();

  const rowRuns = wb.store.runs().filter((run) => run.workflowScope?.inventoryRowId === ROW);
  expect(rowRuns).toHaveLength(3);
  const ledger = wb.rowOutcomes()[project.id]?.[key];
  if (!ledger) throw new Error('workbench ledger seam produced no history for the row');
  expect(ledger.executions).toBe(3);
  expect(wb.store.runs().filter((run) => run.workflowScope?.campaignId === first.id)).toHaveLength(
    1,
  );
  await wb.close();
  cleanups.splice(
    cleanups.indexOf(() => wb.close()),
    1,
  );

  const app = await startWorkbench({
    roots: [repo.root],
    stateDirectory: directory,
    port: 0,
    adminToken: 'inventory-ledger-test-administrator-token',
  });
  cleanups.push(() => app.close());
  const browser = await launchDashboardBrowser();
  cleanups.push(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));
  await page.goto(app.origin);
  await page.getByLabel('Administrator token').fill('inventory-ledger-test-administrator-token');
  await page.getByRole('button', { name: 'Open workbench' }).click();
  await page.getByRole('heading', { name: 'Workspace overview' }).waitFor();
  await page.goto(`${app.origin}?view=intents`);
  const surfaceTable = page.locator('.surface-inventory');
  await surfaceTable.waitFor();

  // The executed surface carries the union across the original campaign and
  // both recurring fires — not just the latest campaign's own run.
  const executed = page.locator(`[data-row-ledger="${key}"]`);
  await expect
    .poll(() => executed.textContent())
    .toContain(`${ledger.verified} verified of 3 executions across campaigns`);

  // A discovery row no campaign ever selected says so explicitly.
  await expect
    .poll(() => page.locator(`[data-row-ledger="${unselectedKey}"]`).textContent())
    .toContain('Not selected for a campaign yet');
  expect(errors).toEqual([]);
}, 240_000);
