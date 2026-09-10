import { once } from 'node:events';
import { openInventoryTab } from './inventory-tabs';
import { createServer, type RequestListener, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DomainInventory } from '@arxic/domain-inventory';
import type { FrontendInventory } from '@arxic/source-ua-adapter';
import {
  bootFixtureApp,
  referenceAuthApp,
  stopApp,
} from '../../../../packages/real-world-testkit/src';
import { makeRepository } from '../../../../packages/source-ua-adapter/src/__tests__/test-repo';
import { Workbench } from '../workbench';
import { routeStateCoverage, runtimeStateMap } from '../route-coverage';
import { observeRuntimeStates } from '../runtime-states';
import { launchDashboardBrowser } from './dashboard-browser';
import { startWorkbench } from './workbench-runtime';

const root = resolve(import.meta.dirname, '../../../..');
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * Source-to-runtime state mapping (refs #402), proven on two real engines:
 * the REAL reference app (unmodified, real build via the testkit) for
 * declared-unobserved and unobserved-undeclared cells, and real HTTP servers
 * whose pages render markers through real scripts — observed by the REAL
 * Chromium observer — for the observed cells (the DG-297 real-server
 * precedent; markup shaped like the observed real-world cases).
 */

describe('runtime state mapping on the real reference app', () => {
  it('observes the real app and maps /login error as declared-unobserved and / as neither', async () => {
    const app = await bootFixtureApp(root, referenceAuthApp, 'runtime-state-map');
    cleanups.push(() => stopApp(app.child));
    const directory = await mkdtemp(join(tmpdir(), 'arxic-rts-web-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const repo = await makeRepository('reference-auth-app');
    cleanups.push(() => rm(repo.root, { recursive: true, force: true }));
    const wb = await Workbench.open(directory, [repo.root]);
    cleanups.push(() => wb.close());
    const project = await wb.saveProject({
      name: 'Runtime state map (real app)',
      folder: repo.root,
      origin: app.origin,
    });
    const discovery = wb.enqueue(project.id, 'discovery');
    await wb.idle();
    const result = wb.store.run(discovery.id)!.result!;
    expect(result.runtimeObservationGap).toBeUndefined();
    expect(result.runtimeStates).toBeDefined();

    const mapping = runtimeStateMap(
      routeStateCoverage(result.inventory as DomainInventory, result.frontend as FrontendInventory),
      result.runtimeStates!,
    );
    const cell = (path: string, name: string) =>
      mapping
        .find((entry) => entry.path === path)
        ?.dimensions.find((dimension) => dimension.name === name)?.mapping;
    // The REAL /login error ternary never renders on a plain visit.
    expect(cell('/login', 'state:error')).toBe('declared-unobserved');
    // The REAL home route: neither side claims a state.
    expect(cell('/', 'state:error')).toBe('unobserved-undeclared');
    expect(cell('/', 'state:loading')).toBe('unobserved-undeclared');
  }, 300_000);
});

describe('runtime state observation on real served pages (real Chromium)', () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (!server) return;
    server.close();
    await once(server, 'close');
    server = undefined;
  });

  const listen = async (handler: RequestListener) => {
    server = createServer(handler);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    return `http://127.0.0.1:${address.port}`;
  };

  it('classifies rendered loading/error/empty markers after hydration', async () => {
    const origin = await listen((_request, response) => {
      response.setHeader('content-type', 'text/html');
      response.end(`<!doctype html><html><body>
<div id="app"></div>
<script>
  setTimeout(function () {
    document.getElementById('app').innerHTML =
      '<p role="status">Inbox is empty</p><p>Request failed — retry</p>';
  }, 200);
</script>
</body></html>`);
    });

    const pass = await observeRuntimeStates(origin, ['/']);
    expect(pass.gap).toBeUndefined();
    expect(pass.observations).toEqual([{ path: '/', states: ['state:error', 'state:empty'] }]);
  });

  it('records an explicit gap for an unreachable origin instead of hanging', async () => {
    const pass = await observeRuntimeStates('http://127.0.0.1:1', ['/']);
    expect(pass.observations).toBeUndefined();
    expect(pass.gap).toBe('origin-unreachable');
  });

  it('maps observed markers onto source declarations (declared-and-observed vs observed-undeclared)', async () => {
    const origin = await listen((request, response) => {
      response.setHeader('content-type', 'text/html');
      // /declared renders the marker its source (below) declares; /dynamic
      // renders one nothing declares — the dynamic-state class.
      const body =
        request.url === '/declared'
          ? '<p>Inbox is empty</p>'
          : request.url === '/dynamic'
            ? '<p>Request failed — retry</p>'
            : '<p>Welcome</p>';
      response.end(`<!doctype html><html><body>${body}</body></html>`);
    });
    const pass = await observeRuntimeStates(origin, ['/', '/declared', '/dynamic']);
    const coverage = [
      {
        method: 'GET',
        path: '/declared',
        files: ['app/declared/page.tsx'],
        dimensions: [
          { name: 'state:loading', status: 'absent', evidence: [] },
          { name: 'state:error', status: 'absent', evidence: [] },
          {
            name: 'state:empty',
            status: 'referenced',
            evidence: [{ path: 'app/declared/page.tsx', startLine: 4, endLine: 4, label: 'x' }],
          },
          { name: 'actions', status: 'absent', evidence: [] },
          { name: 'tests', status: 'absent', evidence: [] },
          { name: 'docs', status: 'absent', evidence: [] },
        ],
      },
    ] as unknown as Awaited<ReturnType<typeof routeStateCoverage>>;
    const mapping = runtimeStateMap(coverage, pass.observations!);
    const cell = (path: string, name: string) =>
      mapping
        .find((entry) => entry.path === path)
        ?.dimensions.find((dimension) => dimension.name === name)?.mapping;
    expect(cell('/declared', 'state:empty')).toBe('declared-and-observed');
    expect(cell('/dynamic', 'state:error')).toBe('observed-undeclared');
    expect(cell('/', 'state:error')).toBe('unobserved-undeclared');
  });
});

describe('runtime state mapping in the real dashboard', () => {
  it('renders the mapping with the honesty boundary for a real served origin', async () => {
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'text/html');
      response.end(
        '<!doctype html><html><body><main><h1>Stack</h1><p>Request failed — retry</p></main></body></html>',
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    const origin = `http://127.0.0.1:${address.port}`;
    const repo = await makeRepository('reference-auth-app');
    const directory = await mkdtemp(join(tmpdir(), 'arxic-rts-ui-'));
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
      await page
        .getByLabel('Project name', { exact: true })
        .fill('Runtime state mapping reference');
      await page.getByLabel('Running test app origin').fill(origin);
      await page.getByRole('button', { name: 'Save project' }).click();
      await page.getByRole('button', { name: 'Read the code', exact: true }).click();
      await expect
        .poll(() => page.locator('.run-detail').textContent(), { timeout: 180_000 })
        .toContain('source surfaces');
      await page.getByRole('button', { name: 'Code scan', exact: true }).click();
      await openInventoryTab(page, 'declarations');

      const block = page.locator('[data-runtime-mapping]');
      const text = async () => (await block.textContent().catch(() => null)) ?? '';
      await expect.poll(text, { timeout: 30_000 }).toContain('Runtime state mapping');
      const row = async (path: string) =>
        (await block
          .locator(`[data-route="${path}"]`)
          .textContent()
          .catch(() => null)) ?? '';
      // The real fixture's /login error ternary is declared, and this origin
      // renders a failure marker on every path — including /login — so the
      // error dimension maps declared-and-observed here.
      await expect.poll(() => row('/login')).toContain('declared-and-observed');
      // The served origin renders a failure marker on every path — routes with
      // no error declaration surface as observed-undeclared.
      await expect.poll(() => row('/')).toContain('observed-undeclared');
      await expect.poll(text).toContain('plain navigation');
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
      await app.close();
      server.close();
      await once(server, 'close');
      await rm(repo.root, { recursive: true, force: true });
      await rm(directory, { recursive: true, force: true });
    }
  }, 300_000);
});
