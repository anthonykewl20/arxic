import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import {
  bootFixtureApp,
  stopApp,
  referenceAuthApp,
  seedFixture,
} from '../../../../packages/real-world-testkit/src';
import { launchDashboardBrowser } from './dashboard-browser';
import { startWorkbench } from './workbench-runtime';

/**
 * The credential vault's end-to-end claim: an administrator types a target
 * site's password into the dashboard once, and a later visual run signs in to
 * that site with it — while the value never appears in the browser, the run
 * record, the action timeline or anything written to disk in the clear.
 *
 * Unit tests cover the encryption. This covers the part they cannot: that the
 * credential actually travels from a form field to a real sign-in. Everything
 * runs over the dashboard's own HTTP surface, so the journey holds against the
 * installed command as well as the source tree.
 */
async function api(page: Page, path: string, method = 'GET', body?: unknown) {
  return page.evaluate(
    async ([target, verb, payload]) => {
      const response = await fetch(target as string, {
        method: verb as string,
        ...(payload === null
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: payload as string }),
      });
      return { status: response.status, body: await response.text() };
    },
    [path, method, body === undefined ? null : JSON.stringify(body)] as const,
  );
}

/** Waits for the queue to drain, then returns the newest run's result. */
async function settleRun(page: Page) {
  await expect
    .poll(
      async () => {
        const { body } = await api(page, '/api/state');
        const state = JSON.parse(body) as { runs: Array<{ state: string }> };
        return state.runs.filter((run) => ['queued', 'running'].includes(run.state)).length;
      },
      { timeout: 120_000, interval: 500 },
    )
    .toBe(0);
  const { body } = await api(page, '/api/state');
  const state = JSON.parse(body) as {
    runs: Array<{ createdAt: string; result?: Record<string, unknown> }>;
  };
  return state.runs[0]?.result;
}

it('signs a real run in with a credential typed into the dashboard, and never discloses it', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const target = await bootFixtureApp(root, referenceAuthApp, 'web-vault-target');
  const state = await mkdtemp(join(tmpdir(), 'arxic-vault-ui-'));
  // No credential in the process environment: the vault is the only source, so
  // a successful sign-in cannot be explained by an inherited variable.
  vi.stubEnv('ARXIC_SECRET_VAULT_EMAIL', '');
  vi.stubEnv('ARXIC_SECRET_VAULT_PASSWORD', '');
  const app = await startWorkbench({
    roots: [root],
    stateDirectory: state,
    adminToken: 'vault-ui-test-administrator-token',
    port: 0,
  });
  const browser = await launchDashboardBrowser({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  try {
    const persona = { email: 'vault-audit@example.test', password: 'VaultAuditOnly9!' };
    await seedFixture(target.origin, 'vault-audit', persona);

    await page.goto(`${app.origin}?view=admin`);
    await page.getByLabel('Administrator token').fill('vault-ui-test-administrator-token');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await page.getByRole('heading', { name: 'Sign-in credentials' }).waitFor();

    const created = await api(page, '/api/projects', 'POST', {
      name: 'Vault reference',
      folder: join(root, 'test-fixtures/reference-auth-app'),
      origin: target.origin,
      captureConsent: true,
      paths: ['/'],
      viewports: [{ width: 800, height: 600 }],
      masks: ['[data-testid="session-state"]'],
      login: {
        loginPath: '/login',
        emailRef: 'ARXIC_SECRET_VAULT_EMAIL',
        passwordRef: 'ARXIC_SECRET_VAULT_PASSWORD',
        emailLabel: 'Email',
        passwordLabel: 'Password',
        submitLabel: 'Login',
      },
    });
    expect(created.status).toBe(201);
    const projectId = (JSON.parse(created.body) as { id: string }).id;

    // Without a value the run refuses, rather than signing in as nobody.
    expect(
      (await api(page, `/api/projects/${projectId}/runs`, 'POST', { mode: 'visual' })).status,
    ).toBe(202);
    expect(await settleRun(page)).toMatchObject({
      outcome: 'blocked',
      findings: [{ kind: 'login-secrets-missing', path: '/login', count: 1 }],
    });

    await page.reload();
    await page.getByRole('heading', { name: 'Sign-in credentials' }).waitFor();
    // The project's declared references are discovered and reported unset.
    const rows = page.locator('.data-table tbody tr', { hasText: 'ARXIC_SECRET_VAULT_' });
    await expect.poll(() => rows.count()).toBe(2);
    expect(await rows.first().textContent()).toContain('Not set');

    for (const [reference, value] of [
      ['ARXIC_SECRET_VAULT_EMAIL', persona.email],
      ['ARXIC_SECRET_VAULT_PASSWORD', persona.password],
    ] as const) {
      const row = page.locator('.data-table tbody tr', { hasText: reference });
      await row.getByRole('button', { name: 'Set value' }).click();
      await page.getByLabel(`Value for ${reference}`).fill(value);
      await page.getByRole('button', { name: 'Save credential' }).click();
      await expect.poll(() => row.textContent()).toContain('Stored here');
    }

    // Write-only: nothing the browser received carries the value back.
    const inventory = await api(page, '/api/secrets');
    const workspace = await api(page, '/api/state');
    for (const body of [inventory.body, workspace.body, await page.content()])
      expect(body).not.toContain(persona.password);

    // The run now signs in, using only what the dashboard stored.
    expect(
      (await api(page, `/api/projects/${projectId}/runs`, 'POST', { mode: 'visual' })).status,
    ).toBe(202);
    const signedIn = await settleRun(page);
    expect(signedIn).toMatchObject({ outcome: 'observed' });
    expect(
      (signedIn as { captures: Array<{ authenticated?: boolean }> }).captures[0],
    ).toMatchObject({ authenticated: true });

    // Nothing on disk holds either value in the clear — not the database, not
    // the vault key file, not the run's evidence or its action timeline.
    for (const entry of await readdir(state, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const bytes = await readFile(join(entry.parentPath, entry.name));
      for (const secret of [persona.email, persona.password])
        expect(bytes.includes(Buffer.from(secret)), `disclosed in ${entry.name}`).toBe(false);
    }

    // Removing it returns the run to refusing, which proves the sign-in above
    // was reading the vault rather than something else.
    const passwordRow = page.locator('.data-table tbody tr', {
      hasText: 'ARXIC_SECRET_VAULT_PASSWORD',
    });
    await passwordRow.getByRole('button', { name: 'Remove ARXIC_SECRET_VAULT_PASSWORD' }).click();
    await page.getByRole('button', { name: 'Remove credential' }).click();
    await expect.poll(() => passwordRow.textContent()).toContain('Not set');
    expect(
      (await api(page, `/api/projects/${projectId}/runs`, 'POST', { mode: 'visual' })).status,
    ).toBe(202);
    expect(await settleRun(page)).toMatchObject({ outcome: 'blocked' });
  } finally {
    await context.close();
    await browser.close();
    await app.close();
    await stopApp(target.child);
    await rm(state, { recursive: true, force: true });
    await rm(target.runtimeDirectory, { recursive: true, force: true });
  }
}, 300_000);
