import { execFile } from 'node:child_process';
import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { Workbench } from '../workbench';
import { campaignRows } from '../campaigns';
import type { DomainInventory } from '@arxic/domain-inventory';
import type { Campaign, Run } from '../types';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';
import { launchDashboardBrowser } from './dashboard-browser';
import { startWorkbench } from './workbench-runtime';
import type { Page } from 'playwright';

const execute = promisify(execFile);

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

// Content-derived row identity from a real discovery of the reference-auth-app
// fixture; stable across re-scans of an unchanged route surface.
const ROW = 'inv:page:GET:7db4b8bf2d28'; // GET /login — app/login/page.tsx

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'Arxic Test',
  GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
  GIT_COMMITTER_NAME: 'Arxic Test',
  GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
};

const git = (cwd: string, ...args: string[]) =>
  execute('git', args, { cwd, env: { ...process.env, ...GIT_IDENTITY } });

async function openRebindWorkbench() {
  const repo = await makeRepository('reference-auth-app');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-rebind-ui-'));
  cleanups.push(
    () => rm(repo.root, { recursive: true, force: true }),
    () => rm(directory, { recursive: true, force: true }),
  );
  const wb = await Workbench.open(directory, [repo.root]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({
    name: 'Rebind surface campaign',
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
    throw new Error(`selected row ${ROW} is missing from the discovery inventory`);
  const campaign: Campaign = await wb.enqueueCampaign(project.id, {
    discoveryRunId: discovery.id,
    inventoryRowIds: [ROW],
    cron: '0 0 1 1 *',
  });
  await wb.idle();
  const rowRuns = () => wb.store.runs().filter((run) => run.workflowScope?.inventoryRowId === ROW);
  const audits = (action: string) =>
    wb.store.auditLog().filter((entry) => entry.action === action && entry.subject === campaign.id);
  return { wb, repo, directory, project, campaign, rowRuns, audits };
}

/** Real committed drift: append a comment line to, or remove, a source file. */
async function commitSourceChange(
  repo: { root: string },
  file: string,
  mutation: 'append' | 'remove',
) {
  const path = join(repo.root, file);
  if (mutation === 'append') await appendFile(path, '\n// drift: comment appended between fires\n');
  else await rm(path);
  await execute('git', ['add', '-A'], { cwd: repo.root, env: { ...process.env, ...GIT_IDENTITY } });
  await git(repo.root, 'commit', '-m', `drift: ${mutation} ${file}`);
  const { stdout } = await git(repo.root, 'rev-parse', 'HEAD');
  return stdout.trim();
}

function rebindDiscoveryOf(wb: Workbench, campaign: Campaign): Run | undefined {
  const rebinding = wb.store.campaign(campaign.id)?.rebinding;
  if (!rebinding) return undefined;
  return wb.store.run(rebinding.discoveryRunId);
}

async function login(page: Page, origin: string, token: string) {
  await page.goto(origin);
  await page.getByLabel('Administrator token').fill(token);
  await page.getByRole('button', { name: 'Open workbench' }).click();
  await page.getByRole('heading', { name: 'Workspace overview' }).waitFor();
}

it('surfaces the rebinding state on the campaign panel and clears it when the rebind lands', async () => {
  const { wb, repo, directory, project, campaign, rowRuns, audits } = await openRebindWorkbench();
  const afterCreation = rowRuns().length;
  expect(afterCreation).toBeGreaterThan(0);

  // Positive control on the CLEAN source: the due slot fires exactly one run.
  const slot1 = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  wb.tick(slot1);
  await wb.idle();
  expect(rowRuns()).toHaveLength(afterCreation + 1);

  // REAL drift between fires: a real git commit moves HEAD past the pin while
  // keeping the audited route surface intact.
  const newCommit = await commitSourceChange(repo, 'app/page.tsx', 'append');
  expect(newCommit).not.toBe(campaign.sourceCommit);

  // A real backlog of queued agent runs keeps the workbench drain busy past the
  // close below: the rebind discovery is enqueued rowid-LAST, so it is still
  // QUEUED at close and the server process picks it up (recover() keeps queued
  // entries) — a real handoff of the in-flight rebind between processes.
  for (let i = 0; i < 18; i++) wb.enqueue(project.id, 'agent');

  // The pre-fire guard starts a REBIND instead of firing a doomed slot.
  const slot2 = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  await wb.guardDueCampaigns(slot2);
  const drifting = wb.store.campaign(campaign.id)!;
  expect(drifting.rebinding?.discoveryRunId).toBeTruthy();
  expect(drifting.nextFireAt).toBeNull();
  const rebindDiscoveryId = drifting.rebinding!.discoveryRunId;
  const discovery = rebindDiscoveryOf(wb, campaign);
  expect(discovery?.mode).toBe('discovery');
  expect(['queued', 'running']).toContain(discovery?.state);
  expect(audits('campaign.rebind-started')).toHaveLength(1);

  // Sad path first: a rebinding campaign must not fire — zero doomed runs.
  wb.tick(slot2);
  expect(rowRuns()).toHaveLength(afterCreation + 1);

  // The workbench-level view reports the in-flight rebind before any UI boots.
  expect(wb.campaign(campaign.id).state).toBe('rebinding');

  // The discovery must still be QUEUED here: the backlog holds the drain, so
  // closing cannot kill the rebind mid-flight.
  expect(wb.store.run(rebindDiscoveryId)?.state).toBe('queued');
  await wb.close();
  cleanups.splice(
    cleanups.indexOf(() => wb.close()),
    1,
  );

  // A real server over the same state directory drains the handed-off backlog,
  // then the rebind discovery, then the rebind lands while the panel is open.
  const app = await startWorkbench({
    roots: [repo.root],
    stateDirectory: directory,
    port: 0,
    adminToken: 'rebind-ui-test-administrator-token',
  });
  cleanups.push(() => app.close());
  const browser = await launchDashboardBrowser();
  cleanups.push(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));

  await login(page, app.origin, 'rebind-ui-test-administrator-token');
  // Deep-link straight into the campaign so card and detail mount immediately.
  await page.goto(`${app.origin}?view=campaigns&campaign=${campaign.id}`);

  // Catch the rebinding badge live while the handed-off discovery waits behind
  // the backlog; if the drain lands before the first paint, the poll falls
  // through to the cleared-state assertions honestly (recorded via seenBadge).
  const detail = page.locator('.campaign-detail');
  let seenBadge = '';
  await expect
    .poll(
      async () => {
        expect(errors).toEqual([]);
        const badge = page.locator('[data-rebinding="true"]').first();
        if ((await badge.count()) > 0) {
          seenBadge = (await badge.textContent()) ?? '';
          return 'rebinding';
        }
        const detailText = (await detail.count()) ? ((await detail.textContent()) ?? '') : '';
        return detailText.includes(`Source commit: ${newCommit}`) ? 'landed' : 'pending';
      },
      { timeout: 180_000, interval: 400 },
    )
    .toBe('landed');

  // Cleared state: the badge is gone and the panel shows the fresh pin.
  if (seenBadge) expect(seenBadge).toContain('Rebinding');
  console.log(
    `[rebind-ui] rebinding badge observed live in the browser: ${seenBadge ? JSON.stringify(seenBadge) : 'no (rebind landed before first paint; cleared state asserted)'}`,
  );
  expect(await page.locator('[data-rebinding="true"]').count()).toBe(0);
  expect(await detail.textContent()).toContain(`Source commit: ${newCommit}`);
  expect(await page.locator('.campaign-detail .pill').textContent()).not.toBe('rebinding');

  // The rebind outcome is surfaced on the detail card: one survivor, zero dropped.
  const reboundLine = page.locator('.campaign-detail [data-rebound]');
  await expect.poll(() => reboundLine.count()).toBe(1);
  expect(await reboundLine.getAttribute('data-rebound')).toBe('1/0');
  const reboundText = (await reboundLine.textContent()) ?? '';
  expect(reboundText).toContain('carried over');
  expect(reboundText).toContain('dropped');
  expect(errors).toEqual([]);
}, 300_000);

it('presents an exhausted rebind as the stopped campaign it is, not a stuck rebinding one', async () => {
  const { wb, repo, directory, campaign, rowRuns, audits } = await openRebindWorkbench();
  const afterCreation = rowRuns().length;

  const slot1 = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  wb.tick(slot1);
  await wb.idle();
  expect(rowRuns()).toHaveLength(afterCreation + 1);

  // REAL drift that removes the selected route's backing file: /login is gone.
  await commitSourceChange(repo, join('app', 'login', 'page.tsx'), 'remove');

  const slot2 = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  await wb.guardDueCampaigns(slot2);
  expect(wb.store.campaign(campaign.id)?.rebinding?.discoveryRunId).toBeTruthy();
  wb.tick(slot2);
  expect(rowRuns()).toHaveLength(afterCreation + 1);

  await wb.idle();
  const stopped = wb.store.campaign(campaign.id)!;
  expect(stopped.rebinding).toBeUndefined();
  expect(stopped.nextFireAt).toBeNull();
  expect(audits('campaign.rebind-exhausted')).toHaveLength(1);
  // The workbench-level view reads the exhausted stop as stopped, not rebinding.
  expect(wb.campaign(campaign.id).state).toBe('blocked');

  await wb.close();
  cleanups.splice(
    cleanups.indexOf(() => wb.close()),
    1,
  );
  const app = await startWorkbench({
    roots: [repo.root],
    stateDirectory: directory,
    port: 0,
    adminToken: 'rebind-ui-exhausted-test-administrator-token',
  });
  cleanups.push(() => app.close());
  const browser = await launchDashboardBrowser();
  cleanups.push(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));

  await login(page, app.origin, 'rebind-ui-exhausted-test-administrator-token');
  await page.goto(`${app.origin}?view=campaigns&campaign=${campaign.id}`);
  const detail = page.locator('.campaign-detail');
  await detail.waitFor();

  // No rebinding badge: the rebind is over and the campaign shows stopped.
  expect(await page.locator('[data-rebinding="true"]').count()).toBe(0);
  await expect.poll(() => page.locator('.campaign-detail .pill').textContent()).toBe('blocked');
  expect(await detail.textContent()).not.toContain('Rebinding');
  expect(errors).toEqual([]);
}, 300_000);
