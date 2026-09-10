import { execFile } from 'node:child_process';
import { openInventoryTab } from './inventory-tabs';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';
import { Workbench } from '../workbench';
import { campaignRows } from '../campaigns';
import { launchDashboardBrowser } from './dashboard-browser';
import { startWorkbench } from './workbench-runtime';
import {
  bootFixtureApp,
  referenceAuthApp,
  seedFixture,
  stopApp,
  type Persona,
} from '../../../../packages/real-world-testkit/src';
import type { DomainInventory } from '@arxic/domain-inventory';
import type { Campaign, Run } from '../types';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../../../..');

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'Arxic Test',
  GIT_COMMITTER_NAME: 'Arxic Test',
  GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
  GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
};
const git = (cwd: string, ...args: string[]) =>
  execute('git', args, { cwd, env: { ...process.env, ...GIT_IDENTITY } });

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const ROW = 'inv:page:GET:7db4b8bf2d28'; // GET /login — app/login/page.tsx
const YEARLY = '0 0 1 1 *'; // unreachable by the 1s background ticker

const ALTERNATE_LOGIN = {
  route: '/login/alternate',
  emailLabel: 'Work email',
  passwordLabel: 'Passphrase',
  submitLabel: 'Sign in',
} as const;

const SEED_PERSONA: Persona = {
  email: 'persona-1d@example.test',
  password: 'Persona1dSecret9!',
  newPassword: 'Persona1dReplacement9!',
};

it('authenticates a seeded user through the real /login/alternate fixture route', async () => {
  const app = await bootFixtureApp(root, referenceAuthApp, 'web-persona-1d');
  cleanups.push(() => stopApp(app.child));
  await seedFixture(app.origin, 'persona-1d', SEED_PERSONA);
  const browser = await launchDashboardBrowser();
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${app.origin}${ALTERNATE_LOGIN.route}`);
    // The alternate route is a real distinct entry point: same heading, its own marker.
    await page.getByRole('heading', { name: 'Login' }).waitFor();
    await page.getByTestId('alternate-login').waitFor();
    await page.getByLabel('Work email').fill(SEED_PERSONA.email);
    await page.getByLabel('Passphrase').fill(SEED_PERSONA.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(`${app.origin}/`);
    // Same assertion style the /login journeys use: the home page session line.
    await expect
      .poll(() => page.getByTestId('session-state').textContent())
      .toBe(`Logged in as ${SEED_PERSONA.email}`);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 240_000);

async function openVariantWorkbench(execution: Record<string, unknown>) {
  const repo = await makeRepository('reference-auth-app');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-variants-1d-'));
  cleanups.push(
    () => rm(repo.root, { recursive: true, force: true }),
    () => rm(directory, { recursive: true, force: true }),
  );
  const wb = await Workbench.open(directory, [repo.root]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({
    name: 'Distinct login path campaign',
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

it('fans a distinct-login-path persona campaign out and diverges the real engine-config snapshots', async () => {
  vi.stubEnv('ARXIC_SECRET_PERSONA_EMAIL', 'default@example.test');
  vi.stubEnv('ARXIC_SECRET_PERSONA_PASSWORD', 'DefaultSecret9!');
  vi.stubEnv('ARXIC_SECRET_PERSONA_A_EMAIL', 'persona-a@example.test');
  vi.stubEnv('ARXIC_SECRET_PERSONA_A_PASSWORD', 'PersonaASecret9!');
  vi.stubEnv('ARXIC_SECRET_PERSONA_B_EMAIL', 'persona-b@example.test');
  vi.stubEnv('ARXIC_SECRET_PERSONA_B_PASSWORD', 'PersonaBSecret9!');
  const { wb, project, discovery, directory } = await openVariantWorkbench({
    model: 'gpt-4o-mini',
    frameworks: ['nextjs'],
    domains: ['authentication'],
    persona: {
      mode: 'per-pass-login',
      emailRef: 'ARXIC_SECRET_PERSONA_EMAIL',
      passwordRef: 'ARXIC_SECRET_PERSONA_PASSWORD',
      // Project login surface: the default /login labels.
      loginPath: '/login',
      emailLabel: 'Email',
      passwordLabel: 'Password',
      submitLabel: 'Login',
    },
  });
  const campaign = await wb.enqueueCampaign(project.id, {
    discoveryRunId: discovery.id,
    inventoryRowIds: [ROW],
    variants: [
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
        login: { ...ALTERNATE_LOGIN },
      },
    ],
  });
  await wb.idle();

  const runs = campaign.runIds.map((id) => wb.store.run(id)!);
  expect(runs).toHaveLength(3); // default + persona-a + persona-b
  expect(runs.map((run) => run.workflowScope?.variantKey)).toEqual([
    undefined,
    'persona-a',
    'persona-b',
  ]);
  // The non-secret login override is stamped on persona-b's scope only.
  expect(runs[2].workflowScope?.variantLogin).toEqual({ ...ALTERNATE_LOGIN });
  expect(runs[0].workflowScope?.variantLogin).toBeUndefined();
  expect(runs[1].workflowScope?.variantLogin).toBeUndefined();

  // Known environment property: no live model → every run ends blocked.
  for (const run of runs) expect(run.state).toBe('blocked');

  // The real per-run engine-config snapshots carry the divergent login surfaces.
  const loginOf = async (run: Run) => {
    const snapshot = JSON.parse(
      await readFile(join(directory, 'runs', run.id, 'engine-config.json'), 'utf8'),
    ) as { fixtures: { replayPersona?: { login?: Record<string, unknown> } } };
    return snapshot.fixtures.replayPersona?.login;
  };
  // Default and persona-a inherit the project login route and labels.
  for (const run of [runs[0], runs[1]]) {
    expect(await loginOf(run)).toEqual({
      route: '/login',
      fields: [
        { label: 'Email', inputRef: 'persona.email' },
        { label: 'Password', inputRef: 'persona.password' },
      ],
      submit: { label: 'Login' },
    });
  }
  // Persona-b logs in through the alternate route with its own labels.
  expect(await loginOf(runs[2])).toEqual({
    route: '/login/alternate',
    fields: [
      { label: 'Work email', inputRef: 'persona.email' },
      { label: 'Passphrase', inputRef: 'persona.password' },
    ],
    submit: { label: 'Sign in' },
  });
}, 180_000);

it('rejects every invalid variant login override with its distinct 400 before enqueueing anything', async () => {
  const { wb, project, discovery } = await openVariantWorkbench({
    model: 'gpt-4o-mini',
    frameworks: ['nextjs'],
    domains: ['authentication'],
  });
  const before = wb.store.runs().length;
  const base = { discoveryRunId: discovery.id, inventoryRowIds: [ROW] };
  const personaVariant = {
    key: 'persona-a',
    label: 'Persona A',
    kind: 'persona',
    persona: {
      emailRef: 'ARXIC_SECRET_PERSONA_A_EMAIL',
      passwordRef: 'ARXIC_SECRET_PERSONA_A_PASSWORD',
    },
  };
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    // route without a leading slash
    [
      { ...base, variants: [{ ...personaVariant, login: { ...ALTERNATE_LOGIN, route: 'login' } }] },
      /variant login route must start with \//u,
    ],
    // login present without a route at all
    [
      { ...base, variants: [{ ...personaVariant, login: { emailLabel: 'Work email' } }] },
      /variant login override requires a route/u,
    ],
    // empty-string label
    [
      {
        ...base,
        variants: [{ ...personaVariant, login: { ...ALTERNATE_LOGIN, emailLabel: '' } }],
      },
      /Variant login labels must be short non-empty text/u,
    ],
    // over-100-character label
    [
      {
        ...base,
        variants: [
          { ...personaVariant, login: { ...ALTERNATE_LOGIN, passwordLabel: 'x'.repeat(101) } },
        ],
      },
      /Variant login labels must be short non-empty text/u,
    ],
    // foreign login payload on a flag entry
    [
      {
        ...base,
        variants: [
          {
            key: 'flag-b',
            label: 'Flag B',
            kind: 'flag',
            flags: { 'new-checkout': true },
            login: { ...ALTERNATE_LOGIN },
          },
        ],
      },
      /must be a list of variant definitions/u,
    ],
    // foreign login payload on a state entry
    [
      {
        ...base,
        variants: [
          {
            key: 'state-c',
            label: 'State C',
            kind: 'state',
            state: 'anonymous',
            login: { ...ALTERNATE_LOGIN },
          },
        ],
      },
      /must be a list of variant definitions/u,
    ],
  ];
  for (const [input, message] of cases)
    await expect(wb.enqueueCampaign(project.id, input)).rejects.toThrow(message);
  expect(wb.store.runs()).toHaveLength(before);
}, 120_000);

it('carries a variant login override through recurring fires and drift rebinds', async () => {
  vi.stubEnv('ARXIC_SECRET_PERSONA_B_EMAIL', 'persona-b@example.test');
  vi.stubEnv('ARXIC_SECRET_PERSONA_B_PASSWORD', 'PersonaBSecret9!');
  const DISTINCT_PATH_VARIANT = {
    key: 'persona-b',
    label: 'Persona B',
    kind: 'persona',
    persona: {
      emailRef: 'ARXIC_SECRET_PERSONA_B_EMAIL',
      passwordRef: 'ARXIC_SECRET_PERSONA_B_PASSWORD',
    },
    login: { ...ALTERNATE_LOGIN },
  } as const;
  const { wb, repo, project, discovery } = await openVariantWorkbench({
    model: 'gpt-4o-mini',
    frameworks: ['nextjs'],
    domains: ['authentication'],
  });
  const campaign = await wb.enqueueCampaign(project.id, {
    discoveryRunId: discovery.id,
    inventoryRowIds: [ROW],
    cron: YEARLY,
    variants: [DISTINCT_PATH_VARIANT],
  });
  await wb.idle();

  // Fire: the fired variant run carries the non-secret login override on its scope.
  const due = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  wb.tick(due);
  await wb.idle();
  const fired = wb.store.campaigns().find((item) => item.id !== campaign.id)!;
  expect(fired.variants).toEqual([DISTINCT_PATH_VARIANT]);
  const firedVariantRun = wb.store.run(fired.runIds[1])!;
  expect(firedVariantRun.workflowScope?.variantKey).toBe('persona-b');
  expect(firedVariantRun.workflowScope?.variantLogin).toEqual({ ...ALTERNATE_LOGIN });
  expect(wb.store.run(fired.runIds[0])!.workflowScope?.variantLogin).toBeUndefined();

  // REAL drift: a real git commit moves HEAD past the pin; the rebind lands and
  // the rebound variant run carries the same login override.
  const path = join(repo.root, 'app/page.tsx');
  await appendFile(path, '\n// drift: login variant override survives rebind\n');
  await execute('git', ['add', '-A'], { cwd: repo.root, env: { ...process.env, ...GIT_IDENTITY } });
  await git(repo.root, 'commit', '-m', 'drift: login variant payload');
  const { stdout } = await git(repo.root, 'rev-parse', 'HEAD');
  const newCommit = stdout.trim();

  const slot = new Date(wb.store.campaign(campaign.id)!.nextFireAt!);
  await wb.guardDueCampaigns(slot);
  await wb.idle();
  const rebound = wb.store.campaign(campaign.id)! as Campaign;
  expect(rebound.rebinding).toBeUndefined();
  expect(rebound.sourceCommit).toBe(newCommit);
  expect(rebound.variants).toEqual([DISTINCT_PATH_VARIANT]);
  const reboundVariantRun = wb.store.run(rebound.runIds[1])!;
  expect(reboundVariantRun.workflowScope?.variantLogin).toEqual({ ...ALTERNATE_LOGIN });
}, 240_000);

it('saves a persona variant with its login override through the real dialog and API', async () => {
  const repo = await makeRepository('reference-auth-app');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-web-persona-variants-1d-ui-'));
  const app = await startWorkbench({
    roots: [repo.root],
    stateDirectory: directory,
    adminToken: 'test-administrator-token-32-characters',
    port: 0,
  });
  const browser = await launchDashboardBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));
  try {
    await page.goto(app.origin);
    await page.getByLabel('Administrator token').fill('test-administrator-token-32-characters');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await page.getByRole('heading', { name: 'Pages', exact: true }).waitFor();
    await page.locator('#new-project').click();
    await page.getByLabel('Project folder', { exact: true }).fill(repo.root);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Project name', { exact: true }).fill('Distinct login path reference');
    await page.getByLabel('Running test app origin').fill('http://127.0.0.1:1');
    await page.getByRole('button', { name: 'Save project' }).click();
    await page.getByRole('button', { name: 'Read the code', exact: true }).click();
    await expect
      .poll(() => page.locator('.run-detail').textContent(), { timeout: 60_000 })
      .toContain('source surfaces');
    await page.getByRole('button', { name: 'Coverage', exact: true }).click();
    await openInventoryTab(page, 'workflows');
    await expect
      .poll(() => page.locator('#content').textContent())
      .toContain('Save guided AI settings to start a campaign');
    await page.getByRole('button', { name: 'Configure campaign settings' }).click();
    await page.getByLabel('Configure AI execution in this dashboard').check();
    await page.getByLabel('Model name', { exact: true }).fill('gpt-4o-mini');
    await page.getByLabel('Frameworks', { exact: false }).fill('nextjs');
    await page.getByLabel('Domain declarations', { exact: false }).fill('authentication');
    await page.getByRole('button', { name: 'Save project' }).click();
    await page.getByRole('checkbox', { name: 'Select GET /login', exact: true }).check();
    await page.waitForResponse(
      (response) => response.url().endsWith('/api/state') && response.ok(),
    );

    // One persona variant row with the full login override (route + three labels).
    await page.getByRole('button', { name: 'Add variant' }).click();
    await page.getByLabel('Variant label').fill('Alternate Persona');
    await page.getByLabel('Variant email secret reference').fill('ARXIC_SECRET_PERSONA_B_EMAIL');
    await page
      .getByLabel('Variant password secret reference')
      .fill('ARXIC_SECRET_PERSONA_B_PASSWORD');
    await page.getByLabel('Variant login route').fill('/login/alternate');
    await page.getByLabel('Variant login email label', { exact: true }).fill('Work email');
    await page.getByLabel('Variant login password label', { exact: true }).fill('Passphrase');
    await page.getByLabel('Variant login submit label', { exact: true }).fill('Sign in');

    // The saved campaign record (the POST response IS the durable record).
    const saved = page.waitForResponse(
      (response) =>
        /\/campaigns$/u.test(response.url()) &&
        response.request().method() === 'POST' &&
        response.ok(),
    );
    await page.getByRole('button', { name: 'Start selected campaign', exact: true }).click();
    const record = (await (await saved).json()) as unknown as Campaign;
    expect(record.variants).toEqual([
      {
        key: 'alternate-persona',
        label: 'Alternate Persona',
        kind: 'persona',
        persona: {
          emailRef: 'ARXIC_SECRET_PERSONA_B_EMAIL',
          passwordRef: 'ARXIC_SECRET_PERSONA_B_PASSWORD',
        },
        login: { ...ALTERNATE_LOGIN },
      },
    ]);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await app.close();
    await rm(repo.root, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
}, 300_000);
