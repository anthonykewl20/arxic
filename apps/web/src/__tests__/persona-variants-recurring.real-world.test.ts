import { execFile } from 'node:child_process';
import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';
import { Workbench } from '../workbench';
import { campaignRows } from '../campaigns';
import type { DomainInventory } from '@arxic/domain-inventory';
import type { Campaign } from '../types';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';

const execute = promisify(execFile);

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const ROW = 'inv:page:GET:7db4b8bf2d28'; // GET /login — app/login/page.tsx
const YEARLY = '0 0 1 1 *'; // unreachable by the 1s background ticker

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'Arxic Test',
  GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
  GIT_COMMITTER_NAME: 'Arxic Test',
  GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
};

const git = (cwd: string, ...args: string[]) =>
  execute('git', args, { cwd, env: { ...process.env, ...GIT_IDENTITY } });

const TWO_PERSONAS = [
  {
    key: 'persona-a',
    label: 'Persona A',
    kind: 'persona',
    persona: {
      emailRef: 'ARXIC_SECRET_PERSONA_A_EMAIL',
      passwordRef: 'ARXIC_SECRET_PERSONA_A_PASSWORD',
    },
  },
  {
    key: 'persona-b',
    label: 'Persona B',
    kind: 'persona',
    persona: {
      emailRef: 'ARXIC_SECRET_PERSONA_B_EMAIL',
      passwordRef: 'ARXIC_SECRET_PERSONA_B_PASSWORD',
    },
  },
] as const;

/** Variant-scope order of a campaign's runs, restored from durable enqueue order. */
const variantKeysOf = (wb: Workbench, campaign: Campaign) =>
  campaign.runIds.map((id) => wb.store.run(id)!).map((run) => run.workflowScope?.variantKey);

async function openRecurringVariantWorkbench(
  variants: readonly NonNullable<Campaign['variants']>[number][] = TWO_PERSONAS,
) {
  const repo = await makeRepository('reference-auth-app');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-persona-variants-recurring-'));
  cleanups.push(
    () => rm(repo.root, { recursive: true, force: true }),
    () => rm(directory, { recursive: true, force: true }),
  );
  const wb = await Workbench.open(directory, [repo.root]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({
    name: 'Recurring persona variant campaign',
    folder: repo.root,
    origin: 'http://127.0.0.1:1',
    execution: { model: 'gpt-4o-mini', frameworks: ['nextjs'], domains: ['authentication'] },
  });
  const discovery = wb.enqueue(project.id, 'discovery');
  await wb.idle();
  const inventory = wb.store.run(discovery.id)?.result?.inventory as DomainInventory | undefined;
  if (!inventory) throw new Error('discovery produced no inventory');
  if (!campaignRows(inventory).some((row) => row.inventoryRowId === ROW))
    throw new Error(`selected row ${ROW} is missing from the discovery inventory`);
  const campaign = await wb.enqueueCampaign(project.id, {
    discoveryRunId: discovery.id,
    inventoryRowIds: [ROW],
    cron: YEARLY,
    variants: [...variants],
  });
  await wb.idle();
  return { wb, repo, project, campaign };
}

it('fires a recurring variant campaign with the full fan-out and per-fire run attribution', async () => {
  const { wb, project, campaign } = await openRecurringVariantWorkbench();
  const initialRunIds = [...campaign.runIds];
  const initialRow = campaign.rows.find((row) => row.inventoryRowId === ROW)!;
  expect(initialRunIds).toHaveLength(3); // creation fan-out: default + 2 variants

  const due = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  wb.tick(due);
  await wb.idle();

  const campaigns = wb.store.campaigns().filter((item) => item.projectId === project.id);
  expect(campaigns).toHaveLength(2);
  const fired = campaigns.find((item) => item.id !== campaign.id)!;
  expect(fired.sourceCommit).toBe(campaign.sourceCommit);
  expect(fired.discoveryRunId).toBe(campaign.discoveryRunId);
  // LOAD-BEARING: the fired record carries the variants — drain resolves fired
  // variant runs' credentials through store.campaign(fired.id).
  expect(fired.variants).toEqual(TWO_PERSONAS);
  expect(variantKeysOf(wb, fired)).toEqual([undefined, 'persona-a', 'persona-b']);
  expect(fired.runIds.every((id) => !initialRunIds.includes(id))).toBe(true);

  // Per-fire attribution: the fired row records THIS fire's runs only.
  const firedRow = fired.rows.find((row) => row.inventoryRowId === ROW)!;
  expect(firedRow.runId).toBe(fired.runIds[0]);
  expect(firedRow.runIds).toEqual([fired.runIds[1], fired.runIds[2]]);
  expect(firedRow.runId).not.toBe(initialRow.runId);
  expect(initialRow.runIds).not.toEqual(firedRow.runIds);

  // The source re-arms and keeps its own creation-run attribution.
  const source = wb.store.campaign(campaign.id)!;
  expect(source.runIds).toEqual(initialRunIds);
  expect(new Date(source.nextFireAt!).getTime()).toBeGreaterThan(due.getTime());
}, 120_000);

it('defers a recurring variant fire without dropping it when the queue cannot fit the fan-out', async () => {
  const { wb, project, campaign } = await openRecurringVariantWorkbench();
  const due = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);

  // 18 real filler entries + the 3-slot fan-out exceed the 20 cap → deferred.
  const fillers = Array.from({ length: 18 }, () => wb.store.enqueue(project, 'agent')!);
  const before = wb.store.runs().length;
  wb.tick(due);
  await wb.idle();
  expect(wb.store.campaigns()).toHaveLength(1); // nothing fired
  expect(wb.store.runs()).toHaveLength(before); // nothing enqueued
  expect(new Date(wb.store.campaign(campaign.id)!.nextFireAt!).getTime()).toBe(due.getTime());

  // Free capacity through the real API; the SAME due slot then lands in full.
  // (The post-tick drain may legitimately finish some fillers itself — those
  // no longer count as active either way.)
  for (const filler of fillers) {
    const state = wb.store.run(filler.id)?.state;
    if (state && ['queued', 'running'].includes(state)) await wb.cancel(filler.id);
  }
  await wb.idle();
  wb.tick(due);
  await wb.idle();
  const fired = wb.store.campaigns().find((item) => item.id !== campaign.id)!;
  expect(variantKeysOf(wb, fired)).toEqual([undefined, 'persona-a', 'persona-b']);
}, 120_000);

it('rebinds a drifted recurring variant campaign by row identity with a variant-aware fan-out', async () => {
  const { wb, repo, campaign } = await openRecurringVariantWorkbench();

  // REAL drift: a real git commit moves HEAD past the pin.
  const path = join(repo.root, 'app/page.tsx');
  await appendFile(path, '\n// drift: comment appended between fires\n');
  await execute('git', ['add', '-A'], { cwd: repo.root, env: { ...process.env, ...GIT_IDENTITY } });
  await git(repo.root, 'commit', '-m', 'drift: append app/page.tsx');
  const { stdout } = await git(repo.root, 'rev-parse', 'HEAD');
  const newCommit = stdout.trim();

  const slot = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  await wb.guardDueCampaigns(slot);
  const rebinding = wb.store.campaign(campaign.id)!;
  expect(rebinding.rebinding?.discoveryRunId).toBeTruthy(); // a REBIND started
  expect(rebinding.nextFireAt).toBeNull();

  await wb.idle(); // the rebind discovery completes and the remap lands
  const rebound = wb.store.campaign(campaign.id)!;
  expect(rebound.rebinding).toBeUndefined();
  expect(rebound.sourceCommit).toBe(newCommit);
  expect(rebound.variants).toEqual(TWO_PERSONAS);
  expect(rebound.nextFireAt).toBeTruthy();
  // Counts stay ROW-level: one survivor, nothing dropped.
  expect(rebound.rebound).toEqual({ survivors: 1, dropped: 0, at: rebound.rebound!.at });
  expect(rebound.runIds).toHaveLength(3);
  expect(variantKeysOf(wb, rebound)).toEqual([undefined, 'persona-a', 'persona-b']);
  const reboundRow = rebound.rows.find((row) => row.inventoryRowId === ROW)!;
  expect(reboundRow.runId).toBe(rebound.runIds[0]);
  expect(reboundRow.runIds).toEqual([rebound.runIds[1], rebound.runIds[2]]);

  const audits = wb.store.auditLog().filter((entry) => entry.subject === campaign.id);
  expect(audits.some((entry) => entry.action === 'campaign.rebind-started')).toBe(true);
  expect(audits.some((entry) => entry.action === 'campaign.rebound')).toBe(true);
  expect(audits.some((entry) => entry.action === 'campaign.rebind-failed')).toBe(false);
}, 240_000);

it('blocks a fired variant run on its unset secret while the fired default run fails at the model stage', async () => {
  vi.stubEnv('ARXIC_SECRET_PERSONA_A_EMAIL', 'persona-a@example.test');
  vi.stubEnv('ARXIC_SECRET_PERSONA_A_PASSWORD', 'PersonaASecret9!');
  // ARXIC_SECRET_PERSONA_B_* deliberately unset.
  const { wb, campaign } = await openRecurringVariantWorkbench();
  const due = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  wb.tick(due);
  await wb.idle();

  const fired = wb.store.campaigns().find((item) => item.id !== campaign.id)!;
  const byVariant = new Map(
    fired.runIds
      .map((id) => wb.store.run(id)!)
      .map((run) => [run.workflowScope?.variantKey ?? 'default', run]),
  );
  const broken = byVariant.get('persona-b')!;
  expect(broken.state).toBe('blocked');
  expect(broken.result?.summary).toBe(
    'A selected secret reference is not available on this server',
  );
  for (const key of ['default', 'persona-a']) {
    const run = byVariant.get(key)!;
    expect(run.state).toBe('blocked'); // model-stage failure, per prior slice notes
    expect(run.result?.summary).not.toBe(
      'A selected secret reference is not available on this server',
    );
  }
}, 120_000);

it('carries a flag variant payload through recurring fires and drift rebinds', async () => {
  const FLAG_VARIANT = {
    key: 'flag-b',
    label: 'Flag B',
    kind: 'flag',
    flags: { 'new-checkout': true },
  } as const;
  const { wb, repo, campaign } = await openRecurringVariantWorkbench([FLAG_VARIANT]);

  // Fire: the fired record's variant run carries the non-secret flag payload.
  const due = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  wb.tick(due);
  await wb.idle();
  const fired = wb.store.campaigns().find((item) => item.id !== campaign.id)!;
  expect(variantKeysOf(wb, fired)).toEqual([undefined, 'flag-b']);
  const firedVariantRun = wb.store.run(fired.runIds[1])!;
  expect(firedVariantRun.workflowScope?.variantFlags).toEqual({ 'new-checkout': true });
  expect(firedVariantRun.workflowScope?.variantState).toBeUndefined();

  // REAL drift: a real git commit moves HEAD past the pin; the rebind lands and
  // the rebound variant run carries the same payload.
  const path = join(repo.root, 'app/page.tsx');
  await appendFile(path, '\n// drift: flag variant payload survives rebind\n');
  await execute('git', ['add', '-A'], { cwd: repo.root, env: { ...process.env, ...GIT_IDENTITY } });
  await git(repo.root, 'commit', '-m', 'drift: flag variant payload');
  const { stdout } = await git(repo.root, 'rev-parse', 'HEAD');
  const newCommit = stdout.trim();

  const slot = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  await wb.guardDueCampaigns(slot);
  await wb.idle();
  const rebound = wb.store.campaign(campaign.id)!;
  expect(rebound.rebinding).toBeUndefined();
  expect(rebound.sourceCommit).toBe(newCommit);
  expect(rebound.variants).toEqual([FLAG_VARIANT]);
  expect(variantKeysOf(wb, rebound)).toEqual([undefined, 'flag-b']);
  const reboundVariantRun = wb.store.run(rebound.runIds[1])!;
  expect(reboundVariantRun.workflowScope?.variantFlags).toEqual({ 'new-checkout': true });
}, 240_000);
