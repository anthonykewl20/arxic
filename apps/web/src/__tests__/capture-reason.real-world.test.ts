import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { Workbench } from '../workbench';
import { startWorkbench } from './workbench-runtime';
import { launchDashboardBrowser } from './dashboard-browser';
import { launchJob } from '../process';

// #502: transient target failures surfaced as opaque zero-capture runs. The
// engine must retain the observed error so a blocked run identifies itself.

it('records the observed navigation error on a blocked zero-capture run', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  // Accepts the connection and destroys it without responding: the deterministic
  // form of the transient empty-response failure class seen in CI (#502).
  const dead = createNetServer((socket) => socket.destroy());
  await new Promise<void>((done) => dead.listen(0, '127.0.0.1', done));
  const directory = await mkdtemp(join(tmpdir(), 'capture-reason-'));
  const wb = await Workbench.open(directory, [root]);
  const browser = await launchDashboardBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let app: Awaited<ReturnType<typeof startWorkbench>> | undefined;
  try {
    const project = await wb.saveProject({
      name: 'Capture reason',
      folder: join(root, 'test-fixtures/vulnerable-auth-app'),
      origin: `http://127.0.0.1:${(dead.address() as AddressInfo).port}`,
      captureConsent: true,
      browsers: ['chromium'],
      colorSchemes: ['light'],
      viewports: [{ width: 800, height: 600 }],
      paths: ['/'],
    });
    const queued = wb.enqueue(project.id, 'visual');
    await wb.idle();
    const run = wb.store.run(queued.id)!;
    expect(run.state).toBe('blocked');
    expect(run.result?.captures).toHaveLength(0);
    const navigation = run.result?.findings?.filter(
      (finding) => 'failurePhase' in finding && finding.failurePhase === 'navigation',
    );
    expect(navigation).toHaveLength(1);
    const reason = (navigation?.[0] as { reason?: string } | undefined)?.reason;
    expect(reason, JSON.stringify(run.result?.findings)).toBeTruthy();
    // The retained evidence names the real navigation failure; which net error
    // the socket teardown produces (RST vs empty response) is timing-dependent.
    expect(reason).toMatch(/^page\.goto: net::ERR_/);
    await wb.close();

    app = await startWorkbench({
      roots: [root],
      stateDirectory: directory,
      port: 0,
      adminToken: 'capture-reason-test-administrator-token',
    });
    await page.goto(app.origin);
    await page.getByLabel('Administrator token').fill('capture-reason-test-administrator-token');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await page.getByRole('heading', { name: 'Pages', exact: true }).waitFor();
    await page.goto(`${app.origin}?view=runs&run=${queued.id}`);
    await expect.poll(() => page.getByText(/net::ERR_/).count()).toBeGreaterThan(0);
  } finally {
    await browser.close();
    if (app) await app.close();
    else await wb.close();
    await rm(directory, { recursive: true, force: true });
    dead.close();
  }
}, 120_000);

it('names the failure when the engine entrypoint cannot read its job input', async () => {
  const state = await mkdtemp(join(tmpdir(), 'capture-reason-job-'));
  const input = join(state, 'absent-input.json');
  const output = join(state, 'result.json');
  const { finished } = launchJob(input, output);
  const code = await finished;
  expect(code).toBe(0);
  const result = JSON.parse(await readFile(output, 'utf8')) as {
    outcome: string;
    summary: string;
  };
  expect(result.outcome).toBe('blocked');
  expect(result.summary).toContain('Engine could not complete this run');
  expect(result.summary).toContain('ENOENT');
  await rm(state, { recursive: true, force: true });
}, 30_000);
