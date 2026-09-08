import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Workbench } from '../workbench';
import { campaignRows } from '../campaigns';
import type { DomainInventory } from '@arxic/domain-inventory';
import type { Campaign, Run } from '../types';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

// Content-derived row identity from a real discovery of the reference-auth-app
// fixture; stable across re-scans of an unchanged route surface.
const ROW = 'inv:page:GET:7db4b8bf2d28'; // GET /login — app/login/page.tsx

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

async function openVariantWorkbench() {
  const repo = await makeRepository('reference-auth-app');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-persona-variants-'));
  cleanups.push(
    () => rm(repo.root, { recursive: true, force: true }),
    () => rm(directory, { recursive: true, force: true }),
  );
  const wb = await Workbench.open(directory, [repo.root]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({
    name: 'Persona variant campaign',
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
  return { wb, repo, project, discovery, directory };
}

it('fans a one-shot campaign out into a default run plus one agent run per declared variant, durably', async () => {
  const { wb, project, discovery, directory } = await openVariantWorkbench();
  const campaign = await wb.enqueueCampaign(project.id, {
    discoveryRunId: discovery.id,
    inventoryRowIds: [ROW],
    variants: TWO_PERSONAS,
  });
  await wb.idle();

  const scoped = (id: string) =>
    wb.store.runs().filter((run) => run.workflowScope?.campaignId === id);
  // store.runs() is rowid-DESC; restore the durable enqueue order.
  const runs = scoped(campaign.id).sort(
    (a, b) => campaign.runIds.indexOf(a.id) - campaign.runIds.indexOf(b.id),
  );
  expect(runs).toHaveLength(3);
  expect(runs.every((run) => run.mode === 'agent')).toBe(true);
  // Declared order is preserved: default first, then variants as declared.
  const keys = runs.map((run) => run.workflowScope?.variantKey);
  expect(keys).toEqual([undefined, 'persona-a', 'persona-b']);
  const stored = wb.store.campaign(campaign.id)!;
  const row = stored.rows.find((item) => item.inventoryRowId === ROW)!;
  expect(row.runId).toBe(runs[0].id);
  expect(row.runIds).toEqual([runs[1].id, runs[2].id]);
  expect(stored.runIds).toEqual(runs.map((run) => run.id));
  expect(stored.variants).toEqual(TWO_PERSONAS);

  // Durability (design AC1): the whole variant record survives a real restart
  // over the same state directory.
  await wb.close();
  const reopened = await Workbench.open(directory, [project.folder]);
  cleanups.push(() => reopened.close());
  const survived = reopened.store.campaign(campaign.id)!;
  const survivedRow = survived.rows.find((item) => item.inventoryRowId === ROW)!;
  expect(survivedRow.runId).toBe(runs[0].id);
  expect(survivedRow.runIds).toEqual([runs[1].id, runs[2].id]);
  expect(survived.runIds).toEqual(runs.map((run) => run.id));
  expect(survived.variants).toEqual(TWO_PERSONAS);
  for (const run of runs) {
    const reread = reopened.store.run(run.id)!;
    expect(reread.workflowScope?.variantKey).toBe(run.workflowScope?.variantKey);
    expect(reread.workflowScope?.inventoryRowId).toBe(ROW);
  }
}, 120_000);

it('rejects every invalid variant configuration with its distinct message before enqueueing anything', async () => {
  const { wb, project, discovery } = await openVariantWorkbench();
  const before = wb.store.runs().length;
  const base = { discoveryRunId: discovery.id, inventoryRowIds: [ROW] };
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ ...base, variants: [TWO_PERSONAS[0], { ...TWO_PERSONAS[1], key: 'persona-a' }] }, /unique/u],
    [
      {
        ...base,
        variants: ['persona-a', 'persona-b', 'persona-c', 'persona-d', 'persona-e'].map((key) => ({
          ...TWO_PERSONAS[0],
          key,
        })),
      },
      /at most 4 variants/u,
    ],
    [{ ...base, variants: [{ ...TWO_PERSONAS[0], key: 'Persona_A' }] }, /lowercase/u],
    [{ ...base, variants: [{ ...TWO_PERSONAS[0], kind: 'flag' }] }, /Unsupported variant kind/u],
    [
      {
        ...base,
        variants: [
          {
            ...TWO_PERSONAS[0],
            persona: { emailRef: 'persona-a@example.test', passwordRef: 'ARXIC_SECRET_X' },
          },
        ],
      },
      /ARXIC_SECRET_ environment names/u,
    ],
    [
      {
        ...base,
        variants: [{ ...TWO_PERSONAS[0], persona: { emailRef: 'ARXIC_SECRET_X', passwordRef: 7 } }],
      },
      /ARXIC_SECRET_ environment names/u,
    ],
  ];
  // Deliberate slice-1b inversion: cron × variants is no longer rejected here —
  // the recurring variant journeys live in persona-variants-recurring.real-world.test.ts.
  for (const [input, message] of cases)
    await expect(wb.enqueueCampaign(project.id, input)).rejects.toThrow(message);
  expect(wb.store.runs()).toHaveLength(before);

  // Capacity scales with the fan-out: rows × (1 + variants) against the 20 cap.
  // Real durable queue entries; cancel them immediately.
  for (let i = 0; i < 18; i++) wb.store.enqueue(project, 'agent');
  try {
    await expect(
      wb.enqueueCampaign(project.id, { ...base, variants: TWO_PERSONAS }),
    ).rejects.toThrow('capacity');
    // 18 active fillers + 3 fan-out slots exceed the 20 cap; nothing enqueued.
    expect(wb.store.runs()).toHaveLength(before + 18);
  } finally {
    for (const run of wb.store.runs()) if (run.state === 'queued') await wb.cancel(run.id);
  }
}, 120_000);

it('blocks the variant run — not the default run — when a variant credential is unset', async () => {
  vi.stubEnv('ARXIC_SECRET_PERSONA_A_EMAIL', 'persona-a@example.test');
  vi.stubEnv('ARXIC_SECRET_PERSONA_A_PASSWORD', 'PersonaASecret9!');
  // ARXIC_SECRET_PERSONA_B_* deliberately unset.
  const { wb, project, discovery } = await openVariantWorkbench();
  const campaign = await wb.enqueueCampaign(project.id, {
    discoveryRunId: discovery.id,
    inventoryRowIds: [ROW],
    variants: TWO_PERSONAS,
  });
  await wb.idle();
  const byVariant = new Map(
    wb.store
      .runs()
      .filter((run) => run.workflowScope?.campaignId === campaign.id)
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

// Deliberate slice-1b inversion: the slice-1 "stops a drifted variant campaign
// at the rebind guard" journey was removed — variant campaigns now rebind by
// row identity, proven in persona-variants-recurring.real-world.test.ts.

/** Compile-time shape helper: keeps the Run workflowScope variant contract honest. */
export type VariantScope = Run['workflowScope'] & { variantKey?: string };
export type VariantCampaign = Campaign & {
  variants?: Campaign['variants'];
};
