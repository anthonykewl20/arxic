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

const execute = promisify(execFile);

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

// Content-derived row identities from a real discovery of the reference-auth-app
// fixture; stable across re-scans of an unchanged route surface.
const ROW = 'inv:page:GET:7db4b8bf2d28'; // GET /login — app/login/page.tsx
const FORGOT = 'inv:page:GET:17251c2c0bbc'; // GET /forgot-password — app/forgot-password/page.tsx

const DRIFT_REFUSAL =
  'Source changed since campaign discovery; commit changes and start a new campaign';

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'Arxic Test',
  GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
  GIT_COMMITTER_NAME: 'Arxic Test',
  GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
};

const git = (cwd: string, ...args: string[]) =>
  execute('git', args, { cwd, env: { ...process.env, ...GIT_IDENTITY } });

async function openRebindWorkbench(selected: string[]) {
  const repo = await makeRepository('reference-auth-app');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-drift-rebind-'));
  cleanups.push(
    () => rm(repo.root, { recursive: true, force: true }),
    () => rm(directory, { recursive: true, force: true }),
  );
  const wb = await Workbench.open(directory, [repo.root]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({
    name: 'Drift rebound campaign',
    folder: repo.root,
    origin: 'http://127.0.0.1:1',
    execution: { model: 'gpt-4o-mini', frameworks: ['nextjs'], domains: ['authentication'] },
  });
  const discovery = wb.enqueue(project.id, 'discovery');
  await wb.idle();
  const inventory = wb.store.run(discovery.id)?.result?.inventory as DomainInventory | undefined;
  if (!inventory) throw new Error('discovery produced no inventory');
  const rows = campaignRows(inventory);
  for (const id of selected)
    if (!rows.some((row) => row.inventoryRowId === id))
      throw new Error(`selected row ${id} is missing from the discovery inventory`);
  const campaign = await wb.enqueueCampaign(project.id, {
    discoveryRunId: discovery.id,
    inventoryRowIds: selected,
    cron: '0 0 1 1 *',
  });
  await wb.idle();
  // Row-scoped execution counter: creation adds one run per selected row, every
  // fire or rebind adds exactly one more per surviving row.
  const rowRuns = (id: string) =>
    wb.store.runs().filter((run) => run.workflowScope?.inventoryRowId === id);
  const audits = (action: string) =>
    wb.store.auditLog().filter((entry) => entry.action === action && entry.subject === campaign.id);
  return { wb, repo, project, campaign, rowRuns, audits };
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

it('rebinds a commit-drifted recurring campaign by row identity and keeps firing on the new source', async () => {
  const { wb, repo, campaign, rowRuns, audits } = await openRebindWorkbench([ROW]);
  const afterCreation = rowRuns(ROW).length;
  expect(afterCreation).toBeGreaterThan(0);

  // Positive control on the CLEAN source: the due slot fires exactly one run.
  const slot1 = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  wb.tick(slot1);
  await wb.idle();
  expect(rowRuns(ROW)).toHaveLength(afterCreation + 1);

  // REAL drift between fires: a real git commit moves HEAD past the pin while
  // keeping the audited route surface intact.
  const newCommit = await commitSourceChange(repo, 'app/page.tsx', 'append');
  expect(newCommit).not.toBe(campaign.sourceCommit);

  // The pre-fire guard starts a REBIND instead of stopping the schedule.
  const slot2 = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  await wb.guardDueCampaigns(slot2);
  const drifting = wb.store.campaign(campaign.id)!;
  expect(drifting.rebinding?.discoveryRunId).toBeTruthy();
  expect(drifting.nextFireAt).toBeNull();
  const discovery = rebindDiscoveryOf(wb, campaign);
  expect(discovery?.mode).toBe('discovery');
  expect(['queued', 'running']).toContain(discovery?.state);
  expect(audits('campaign.rebind-started')).toHaveLength(1);
  expect(audits('campaign.schedule-drift-stopped')).toHaveLength(0);

  // A rebinding campaign must not fire: zero doomed runs while rebinding.
  wb.tick(slot2);
  expect(rowRuns(ROW)).toHaveLength(afterCreation + 1);

  // The discovery completes and the completion hook remaps the campaign.
  await wb.idle();
  const rebound = wb.store.campaign(campaign.id)!;
  expect(rebound.id).toBe(campaign.id);
  expect(rebound.rebinding).toBeUndefined();
  expect(rebound.sourceCommit).toBe(newCommit);
  expect(rebound.discoveryRunId).toBe(discovery!.id);
  expect(rebound.nextFireAt).toBeTruthy();
  expect(rebound.rows.find((row) => row.inventoryRowId === ROW)?.runId).toBeTruthy();
  expect(rebound.runIds).toHaveLength(1);
  expect(audits('campaign.rebound')).toHaveLength(1);

  // FRESH read from the store: the rebind outcome counts land as data on the
  // campaign record — one survivor, nothing dropped.
  const freshHappy = wb.store.campaign(campaign.id)!;
  expect(freshHappy.rebound).toBeDefined();
  expect(freshHappy.rebound!.survivors).toBe(1);
  expect(freshHappy.rebound!.dropped).toBe(0);
  expect(typeof freshHappy.rebound!.at).toBe('string');

  // The re-armed slot fires on the NEW source with a NEW-commit scope.
  const slot3 = new Date(rebound.nextFireAt!);
  wb.tick(slot3);
  await wb.idle();
  expect(rowRuns(ROW)).toHaveLength(afterCreation + 3);
  expect(rowRuns(ROW)[0].workflowScope?.sourceCommit).toBe(newCommit);
  expect(rowRuns(ROW).every((run) => run.result?.summary !== DRIFT_REFUSAL)).toBe(true);
}, 240_000);

it('stops with rebind-exhausted when the drifted inventory no longer contains the selection', async () => {
  const { wb, repo, campaign, rowRuns, audits } = await openRebindWorkbench([ROW]);
  const afterCreation = rowRuns(ROW).length;

  const slot1 = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  wb.tick(slot1);
  await wb.idle();
  expect(rowRuns(ROW)).toHaveLength(afterCreation + 1);

  // REAL drift that removes the selected route's backing file: /login is gone.
  await commitSourceChange(repo, join('app', 'login', 'page.tsx'), 'remove');

  const slot2 = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  await wb.guardDueCampaigns(slot2);
  expect(wb.store.campaign(campaign.id)?.rebinding?.discoveryRunId).toBeTruthy();
  expect(wb.store.campaign(campaign.id)?.nextFireAt).toBeNull();
  wb.tick(slot2);
  expect(rowRuns(ROW)).toHaveLength(afterCreation + 1);

  await wb.idle();
  const stopped = wb.store.campaign(campaign.id)!;
  expect(stopped.rebinding).toBeUndefined();
  // Stop paths stay field-free: no rebind landed, so no outcome counts exist.
  expect(stopped.rebound).toBeUndefined();
  expect(stopped.nextFireAt).toBeNull();
  expect(audits('campaign.rebind-exhausted')).toHaveLength(1);
  expect(audits('campaign.rebound')).toHaveLength(0);
  expect(rowRuns(ROW)).toHaveLength(afterCreation + 1);
  expect(wb.store.runs().filter((run) => ['queued', 'running'].includes(run.state))).toHaveLength(
    0,
  );
}, 240_000);

it('rebinds partially: survivors remap and fire while dropped rows stop and stay audited', async () => {
  const { wb, repo, campaign, rowRuns, audits } = await openRebindWorkbench([ROW, FORGOT]);
  const afterCreation = { row: rowRuns(ROW).length, forgot: rowRuns(FORGOT).length };
  expect(afterCreation.row).toBeGreaterThan(0);
  expect(afterCreation.forgot).toBeGreaterThan(0);

  const slot1 = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  wb.tick(slot1);
  await wb.idle();
  expect(rowRuns(ROW)).toHaveLength(afterCreation.row + 1);
  expect(rowRuns(FORGOT)).toHaveLength(afterCreation.forgot + 1);

  // REAL drift that removes only the forgot-password route: /login survives.
  const newCommit = await commitSourceChange(
    repo,
    join('app', 'forgot-password', 'page.tsx'),
    'remove',
  );

  const slot2 = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  await wb.guardDueCampaigns(slot2);
  expect(wb.store.campaign(campaign.id)?.rebinding?.discoveryRunId).toBeTruthy();
  wb.tick(slot2);
  expect(rowRuns(ROW)).toHaveLength(afterCreation.row + 1);
  expect(rowRuns(FORGOT)).toHaveLength(afterCreation.forgot + 1);

  await wb.idle();
  const rebound = wb.store.campaign(campaign.id)!;
  expect(rebound.id).toBe(campaign.id);
  expect(rebound.rebinding).toBeUndefined();
  expect(rebound.sourceCommit).toBe(newCommit);
  expect(rebound.nextFireAt).toBeTruthy();
  expect(rebound.rows.find((row) => row.inventoryRowId === ROW)?.runId).toBeTruthy();
  expect(rebound.rows.some((row) => row.inventoryRowId === FORGOT)).toBe(false);
  expect(rebound.runIds).toHaveLength(1);
  expect(audits('campaign.rebound')).toHaveLength(1);
  expect(
    wb.store
      .auditLog()
      .some(
        (entry) =>
          entry.action === 'campaign.rebound-row-dropped' &&
          entry.subject === `${campaign.id}/${FORGOT}`,
      ),
  ).toBe(true);
  expect(audits('campaign.rebind-exhausted')).toHaveLength(0);

  // FRESH read: the partial outcome is recorded exactly — one survivor, one drop.
  const freshPartial = wb.store.campaign(campaign.id)!;
  expect(freshPartial.rebound).toBeDefined();
  expect(freshPartial.rebound!.survivors).toBe(1);
  expect(freshPartial.rebound!.dropped).toBe(1);

  // The re-armed slot fires the survivor on the new source; the dropped row is done.
  const slot3 = new Date(rebound.nextFireAt!);
  wb.tick(slot3);
  await wb.idle();
  expect(rowRuns(ROW)).toHaveLength(afterCreation.row + 3);
  expect(rowRuns(ROW)[0].workflowScope?.sourceCommit).toBe(newCommit);
  expect(rowRuns(FORGOT)).toHaveLength(afterCreation.forgot + 1);
}, 240_000);

it('stops with rebind-failed when the rebind discovery cannot complete', async () => {
  const { wb, repo, campaign, rowRuns, audits } = await openRebindWorkbench([ROW]);
  const afterCreation = rowRuns(ROW).length;

  const slot1 = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  wb.tick(slot1);
  await wb.idle();
  expect(rowRuns(ROW)).toHaveLength(afterCreation + 1);

  await commitSourceChange(repo, 'app/page.tsx', 'append');
  const slot2 = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  await wb.guardDueCampaigns(slot2);
  expect(wb.store.campaign(campaign.id)?.rebinding?.discoveryRunId).toBeTruthy();

  // The workspace vanishes before the discovery engine can run: a real failure,
  // not a mock — the run records a blocked result.
  await rm(repo.root, { recursive: true, force: true });

  wb.tick(slot2);
  expect(rowRuns(ROW)).toHaveLength(afterCreation + 1);

  await wb.idle();
  const stopped = wb.store.campaign(campaign.id)!;
  expect(stopped.rebinding).toBeUndefined();
  expect(stopped.nextFireAt).toBeNull();
  expect(audits('campaign.rebind-failed')).toHaveLength(1);
  expect(rowRuns(ROW)).toHaveLength(afterCreation + 1);
}, 240_000);
