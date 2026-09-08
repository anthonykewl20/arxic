import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Workbench } from '../workbench';
import { campaignRows } from '../campaigns';
import type { DomainInventory } from '@arxic/domain-inventory';
import type { Run } from '../types';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const ROW = 'inv:page:GET:7db4b8bf2d28'; // GET /login — app/login/page.tsx

/**
 * Mixed-kind variant list: one persona (credential refs), one flag override,
 * one anonymous state override. Declared order is the fan-out order.
 */
const MIXED_VARIANTS = [
  {
    key: 'persona-a',
    label: 'Persona A',
    kind: 'persona',
    persona: {
      emailRef: 'ARXIC_SECRET_PERSONA_A_EMAIL',
      passwordRef: 'ARXIC_SECRET_PERSONA_A_PASSWORD',
    },
  },
  { key: 'flag-b', label: 'Flag B', kind: 'flag', flags: { 'new-checkout': true } },
  { key: 'state-c', label: 'State C', kind: 'state', state: 'anonymous' },
] as const;

async function openVariantWorkbench(execution: Record<string, unknown>) {
  const repo = await makeRepository('reference-auth-app');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-variants-1c-'));
  cleanups.push(
    () => rm(repo.root, { recursive: true, force: true }),
    () => rm(directory, { recursive: true, force: true }),
  );
  const wb = await Workbench.open(directory, [repo.root]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({
    name: 'Mixed variant campaign',
    folder: repo.root,
    origin: 'http://127.0.0.1:1',
    execution,
  });
  const discovery = wb.enqueue(project.id, 'discovery');
  await wb.idle();
  const inventory = wb.store.run(discovery.id)?.result?.inventory as DomainInventory | undefined;
  if (!inventory) throw new Error('discovery produced no inventory');
  if (!campaignRows(inventory).some((row) => row.inventoryRowId === ROW))
    throw new Error(`selected row ${ROW} is missing from the discovery inventory`);
  return { wb, repo, project, discovery, directory };
}

/** Campaign runs in durable enqueue order, keyed by variantKey (undefined = default). */
function variantRunsOf(wb: Workbench, campaignId: string): Run[] {
  const campaign = wb.store.campaign(campaignId)!;
  return campaign.runIds.map((id) => wb.store.run(id)!);
}

it('fans a mixed persona/flag/state campaign out in declared order and diverges the real engine-config snapshots', async () => {
  // Persona secrets resolve for the default run AND the persona variant, so every
  // run reaches the engine (child) stage; without a live model all end blocked —
  // divergence is proven on the engine-config.json artifact each child writes.
  vi.stubEnv('ARXIC_SECRET_PERSONA_EMAIL', 'default@example.test');
  vi.stubEnv('ARXIC_SECRET_PERSONA_PASSWORD', 'DefaultSecret9!');
  vi.stubEnv('ARXIC_SECRET_PERSONA_A_EMAIL', 'persona-a@example.test');
  vi.stubEnv('ARXIC_SECRET_PERSONA_A_PASSWORD', 'PersonaASecret9!');
  const { wb, project, discovery, directory } = await openVariantWorkbench({
    model: 'gpt-4o-mini',
    frameworks: ['nextjs'],
    domains: ['authentication'],
    featureFlags: { 'checkout-v1': false },
    // per-pass-login keeps the default run non-degenerate against the state variant.
    persona: {
      mode: 'per-pass-login',
      emailRef: 'ARXIC_SECRET_PERSONA_EMAIL',
      passwordRef: 'ARXIC_SECRET_PERSONA_PASSWORD',
    },
  });
  const campaign = await wb.enqueueCampaign(project.id, {
    discoveryRunId: discovery.id,
    inventoryRowIds: [ROW],
    variants: MIXED_VARIANTS,
  });
  await wb.idle();

  const runs = variantRunsOf(wb, campaign.id);
  expect(runs).toHaveLength(4);
  expect(runs.every((run) => run.mode === 'agent')).toBe(true);
  expect(runs.map((run) => run.workflowScope?.variantKey)).toEqual([
    undefined,
    'persona-a',
    'flag-b',
    'state-c',
  ]);
  // Non-secret payload stamped on the scope; persona entries stay variantKey-only.
  expect(runs[2].workflowScope?.variantFlags).toEqual({ 'new-checkout': true });
  expect(runs[3].workflowScope?.variantState).toBe('anonymous');
  expect(runs[1].workflowScope?.variantFlags).toBeUndefined();
  expect(runs[1].workflowScope?.variantState).toBeUndefined();
  expect(runs[0].workflowScope?.variantFlags).toBeUndefined();

  // Known environment property: no live model → every run ends blocked at the
  // engine stage, never faked.
  for (const run of runs) expect(run.state).toBe('blocked');

  // The real, inspectable per-run engine-config snapshots diverge by variant.
  const snapshotOf = async (run: Run) =>
    JSON.parse(await readFile(join(directory, 'runs', run.id, 'engine-config.json'), 'utf8')) as {
      scope: { personas: string[]; featureFlags: Record<string, boolean> };
      fixtures: Record<string, unknown>;
    };
  const [defaultSnap, personaSnap, flagSnap, stateSnap] = [
    await snapshotOf(runs[0]),
    await snapshotOf(runs[1]),
    await snapshotOf(runs[2]),
    await snapshotOf(runs[3]),
  ];
  // Default: the project's per-pass-login fixtures and flag set, verbatim.
  expect(defaultSnap.fixtures.replayPersona).toBeTruthy();
  expect(defaultSnap.scope.personas).toContain('registered-user');
  expect(defaultSnap.scope.featureFlags).toEqual({ 'checkout-v1': false });
  // Persona variant: same config divergence surface as the default (credentials
  // live in the child env, not the config).
  expect(personaSnap.fixtures.replayPersona).toBeTruthy();
  expect(personaSnap.scope.featureFlags).toEqual({ 'checkout-v1': false });
  // Flag variant: the override merges over the project flags.
  expect(flagSnap.fixtures.replayPersona).toBeTruthy();
  expect(flagSnap.scope.featureFlags).toEqual({ 'checkout-v1': false, 'new-checkout': true });
  // State variant: anonymous personas, no replayPersona/personaProvisioner.
  expect(stateSnap.scope.personas).toEqual(['anonymous']);
  expect(stateSnap.fixtures.replayPersona).toBeUndefined();
  expect(stateSnap.fixtures.personaProvisioner).toBeUndefined();
}, 180_000);

it('rejects every invalid flag/state variant shape with its distinct 400 before enqueueing anything', async () => {
  const { wb, project, discovery } = await openVariantWorkbench({
    model: 'gpt-4o-mini',
    frameworks: ['nextjs'],
    domains: ['authentication'],
  });
  const before = wb.store.runs().length;
  const base = { discoveryRunId: discovery.id, inventoryRowIds: [ROW] };
  const flagVariant = {
    key: 'flag-b',
    label: 'Flag B',
    kind: 'flag',
    flags: { 'new-checkout': true },
  };
  const thirtyOne = Object.fromEntries(
    Array.from({ length: 31 }, (_, index) => [`flag${index}`, true]),
  );
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    // 0 flags
    [{ ...base, variants: [{ ...flagVariant, flags: {} }] }, /1–30 named boolean flags/u],
    // 31 flags
    [{ ...base, variants: [{ ...flagVariant, flags: thirtyOne }] }, /1–30 named boolean flags/u],
    // missing flags payload entirely
    [
      { ...base, variants: [{ key: 'flag-b', label: 'Flag B', kind: 'flag' }] },
      /1–30 named boolean flags/u,
    ],
    // bad flag names
    [{ ...base, variants: [{ ...flagVariant, flags: { '9bad': true } }] }, /Flag names use/u],
    [{ ...base, variants: [{ ...flagVariant, flags: { 'has space': true } }] }, /Flag names use/u],
    // non-boolean flag value
    [
      { ...base, variants: [{ ...flagVariant, flags: { 'new-checkout': 'yes' } }] },
      /Flag values must be booleans/u,
    ],
    // foreign entry keys (persona payload on a flag kind; flags on a persona kind)
    [
      {
        ...base,
        variants: [
          {
            ...flagVariant,
            persona: { emailRef: 'ARXIC_SECRET_X', passwordRef: 'ARXIC_SECRET_Y' },
          },
        ],
      },
      /must be a list of/u,
    ],
    [
      {
        ...base,
        variants: [
          {
            key: 'persona-a',
            label: 'Persona A',
            kind: 'persona',
            flags: { x: true },
            persona: { emailRef: 'ARXIC_SECRET_X', passwordRef: 'ARXIC_SECRET_Y' },
          },
        ],
      },
      /must be a list of/u,
    ],
    // state value other than anonymous
    [
      { ...base, variants: [{ key: 'state-c', label: 'State C', kind: 'state', state: 'seeded' }] },
      /only supported state variant is anonymous/u,
    ],
    [
      { ...base, variants: [{ key: 'state-c', label: 'State C', kind: 'state' }] },
      /only supported state variant is anonymous/u,
    ],
    // degenerate state variant: this project's default persona is already anonymous
    [
      {
        ...base,
        variants: [{ key: 'state-c', label: 'State C', kind: 'state', state: 'anonymous' }],
      },
      /identical to this project.s default persona/u,
    ],
  ];
  for (const [input, message] of cases)
    await expect(wb.enqueueCampaign(project.id, input)).rejects.toThrow(message);
  expect(wb.store.runs()).toHaveLength(before);
}, 120_000);

it('accepts a state variant when the project default persona is not anonymous', async () => {
  vi.stubEnv('ARXIC_SECRET_PERSONA_EMAIL', 'default@example.test');
  vi.stubEnv('ARXIC_SECRET_PERSONA_PASSWORD', 'DefaultSecret9!');
  const { wb, project, discovery } = await openVariantWorkbench({
    model: 'gpt-4o-mini',
    frameworks: ['nextjs'],
    domains: ['authentication'],
    persona: {
      mode: 'per-pass-login',
      emailRef: 'ARXIC_SECRET_PERSONA_EMAIL',
      passwordRef: 'ARXIC_SECRET_PERSONA_PASSWORD',
    },
  });
  const campaign = await wb.enqueueCampaign(project.id, {
    discoveryRunId: discovery.id,
    inventoryRowIds: [ROW],
    variants: [{ key: 'state-c', label: 'State C', kind: 'state', state: 'anonymous' }],
  });
  await wb.idle();
  const runs = variantRunsOf(wb, campaign.id);
  expect(runs).toHaveLength(2);
  expect(runs.map((run) => run.workflowScope?.variantKey)).toEqual([undefined, 'state-c']);
}, 120_000);

it('blocks a persona variant on its unset secret while flag/state variants reach the engine with their payload', async () => {
  vi.stubEnv('ARXIC_SECRET_PERSONA_A_EMAIL', 'persona-a@example.test');
  // ARXIC_SECRET_PERSONA_A_PASSWORD deliberately unset → persona run blocks at drain.
  const { wb, project, discovery, directory } = await openVariantWorkbench({
    model: 'gpt-4o-mini',
    frameworks: ['nextjs'],
    domains: ['authentication'],
  });
  const campaign = await wb.enqueueCampaign(project.id, {
    discoveryRunId: discovery.id,
    inventoryRowIds: [ROW],
    // Persona (broken secret) + flag: the project default is anonymous, which
    // would make a state variant degenerate — that pair is covered above.
    variants: [MIXED_VARIANTS[0], MIXED_VARIANTS[1]],
  });
  await wb.idle();
  const byVariant = new Map(
    variantRunsOf(wb, campaign.id).map((run) => [run.workflowScope?.variantKey ?? 'default', run]),
  );
  const persona = byVariant.get('persona-a')!;
  expect(persona.state).toBe('blocked');
  expect(persona.result?.summary).toBe(
    'A selected secret reference is not available on this server',
  );
  // The persona run never launched a child: no engine-config snapshot exists.
  await expect(
    readFile(join(directory, 'runs', persona.id, 'engine-config.json')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
  // Flag and state runs reach the model stage (blocked without a live model) and
  // their engine-config snapshots carry the variant payload.
  for (const [key, expected] of [['flag-b', { 'new-checkout': true }]] as const) {
    const run = byVariant.get(key)!;
    expect(run.state).toBe('blocked');
    expect(run.result?.summary).not.toBe(
      'A selected secret reference is not available on this server',
    );
    const snapshot = JSON.parse(
      await readFile(join(directory, 'runs', run.id, 'engine-config.json'), 'utf8'),
    ) as { scope: { featureFlags: Record<string, boolean> } };
    expect(snapshot.scope.featureFlags).toEqual(expected);
  }
  const stateRun = byVariant.get('state-c');
  expect(stateRun).toBeUndefined(); // no degenerate state variant in this campaign
}, 180_000);
