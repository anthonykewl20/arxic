import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { Workbench } from '../workbench';
import { startWorkbench } from './workbench-runtime';
import { launchDashboardBrowser } from './dashboard-browser';
import { dashboardProof } from './dashboard-proof';

it('corroborates outgoing-document fetch diagnostics with native window events', async () => {
  if (process.env.ARXIC_DASHBOARD_BROWSER !== 'webkit')
    throw new Error('This diagnostic requires ARXIC_DASHBOARD_BROWSER=webkit');
  const root = resolve(import.meta.dirname, '../../../..');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-navigation-errors-'));
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'navigation-errors');
  const wb = await Workbench.open(directory, [root]);
  let app: Awaited<ReturnType<typeof startWorkbench>> | undefined;
  const browser = await launchDashboardBrowser();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const evidence = process.env.ARXIC_NAVIGATION_EVIDENCE_DIR;
  const proof = dashboardProof(page, evidence);
  const events: Array<{ sequence: number; stage: string; kind: string; endpoint?: string }> = [];
  let stage = 'setup';
  const record = (kind: string, endpoint?: string) =>
    events.push({ sequence: events.length, stage, kind, ...(endpoint ? { endpoint } : {}) });
  const endpoint = (value: string) =>
    ['/api/state', '/api/session', '/api/runs'].find((path) => value.includes(path)) ?? 'other';
  page.on('console', (message) => {
    const marker = message.text();
    if (
      [
        'arxic-native-ready',
        'arxic-native-hide',
        'arxic-native-error',
        'arxic-native-rejection',
      ].includes(marker)
    )
      record(marker);
  });
  page.on('pageerror', (error) =>
    record(
      error.message.includes('arxic-canary-window') ||
        error.message.includes('arxic-canary-rejection')
        ? 'driver-canary'
        : `${error.name}: ${error.message}`.startsWith('Fetch API cannot load')
          ? 'driver-fetch-load'
          : 'driver-other-error',
      endpoint(`${error.name}: ${error.message}`),
    ),
  );
  page.on('requestfailed', (request) =>
    record(
      request.failure()?.errorText.includes('cancel') ? 'request-cancelled' : 'request-failed',
      endpoint(new URL(request.url()).pathname),
    ),
  );
  // Observation only: no application state, request or navigation is changed by these listeners.
  await page.addInitScript(() => {
    console.info('arxic-native-ready');
    addEventListener('pagehide', () => console.info('arxic-native-hide'));
    addEventListener('error', () => console.info('arxic-native-error'));
    addEventListener('unhandledrejection', () => console.info('arxic-native-rejection'));
  });
  try {
    const project = await wb.saveProject({
      name: 'Navigation reference',
      folder: join(root, 'test-fixtures/vulnerable-auth-app'),
      origin: target.origin,
      captureConsent: true,
      viewports: [{ width: 800, height: 600 }],
    });
    const queued = wb.enqueue(project.id, 'visual');
    await wb.idle();
    expect(wb.store.run(queued.id)?.state).toBe('completed');
    await wb.close();
    app = await startWorkbench({
      roots: [root],
      stateDirectory: directory,
      port: 0,
      adminToken: 'navigation-observer-test-token-32-characters',
    });
    const url = `${app.origin}?view=runs&run=${queued.id}`;
    await page.goto(url);
    await page
      .getByLabel('Administrator token')
      .fill('navigation-observer-test-token-32-characters');
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await page.getByRole('button', { name: 'Approve as baseline', exact: true }).waitFor();
    await proof.audit(
      '01-ready',
      'Real bookmarked reference run is visible before navigation diagnostics',
    );
    stage = 'canary-error';
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('arxic-canary-window');
      }, 0);
    });
    await expect
      .poll(
        () =>
          events.filter(
            (event) => event.stage === 'canary-error' && event.kind === 'arxic-native-error',
          ).length,
      )
      .toBe(1);
    await expect
      .poll(
        () =>
          events.filter((event) => event.stage === 'canary-error' && event.kind === 'driver-canary')
            .length,
      )
      .toBe(1);
    stage = 'canary-rejection';
    await page.evaluate(() => {
      void Promise.reject(new Error('arxic-canary-rejection'));
    });
    await expect
      .poll(
        () =>
          events.filter(
            (event) =>
              event.stage === 'canary-rejection' && event.kind === 'arxic-native-rejection',
          ).length,
      )
      .toBe(1);
    await expect
      .poll(
        () =>
          events.filter(
            (event) => event.stage === 'canary-rejection' && event.kind === 'driver-canary',
          ).length,
      )
      .toBe(1);
    stage = 'response-boundary-navigation';
    for (let attempt = 0; attempt < 100; attempt++) {
      const stateResponse = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/api/state',
      );
      await page.goto(url, { waitUntil: 'commit' });
      await stateResponse;
    }
    await page.getByRole('button', { name: 'Approve as baseline', exact: true }).waitFor();
    const fetchErrors = events.filter((event) => event.kind === 'driver-fetch-load').length;
    const nativeErrors = events.filter(
      (event) =>
        !event.stage.startsWith('canary-') &&
        (event.kind === 'arxic-native-error' || event.kind === 'arxic-native-rejection'),
    ).length;
    await proof.audit(
      '02-after-navigation',
      'Observe driver fetch diagnostics and native window exceptions after real reloads',
      [
        {
          id: 'fetch-diagnostic-reproduced',
          passed: fetchErrors > 0,
          values: { count: fetchErrors },
        },
        {
          id: 'native-error-observation',
          passed: nativeErrors === 0,
          values: { count: nativeErrors },
        },
      ],
    );
    console.info('Navigation diagnostic counts', {
      fetchErrors,
      nativeErrors,
      ready: events.filter((event) => event.kind === 'arxic-native-ready').length,
    });
    expect(
      fetchErrors,
      'A non-reproducing probe is not evidence for classification',
    ).toBeGreaterThan(0);
    expect(nativeErrors).toBe(0);
    stage = 'active-fetch-failure';
    await page.route('**/api/runs?**', (route) => route.abort('accessdenied'));
    await page.getByRole('button', { name: 'Test runs', exact: true }).click();
    await page
      .getByText('Run history could not be loaded. Retry or check your connection.', {
        exact: true,
      })
      .waitFor();
    const activeFetchErrors = events.filter(
      (event) => event.stage === stage && event.kind === 'driver-fetch-load',
    ).length;
    await proof.audit(
      '03-active-fetch-failure',
      'An active browser request refusal in the active page must remain an error, not a navigation exemption',
      [
        {
          id: 'active-fetch-error-observed',
          passed: activeFetchErrors > 0,
          values: { count: activeFetchErrors },
        },
      ],
    );
    expect(activeFetchErrors).toBeGreaterThan(0);
    await page.unroute('**/api/runs?**');
    stage = 'throw-fetch-lookalike';
    await page.evaluate(() => {
      setTimeout(() => {
        const error = new Error('//local.invalid/api/runs due to access control checks.');
        error.name = 'Fetch API cannot load http';
        throw error;
      }, 0);
    });
    await expect
      .poll(
        () =>
          events.filter(
            (event) =>
              event.stage === 'throw-fetch-lookalike' && event.kind === 'driver-fetch-load',
          ).length,
      )
      .toBe(1);
    await expect
      .poll(
        () =>
          events.filter(
            (event) =>
              event.stage === 'throw-fetch-lookalike' && event.kind === 'arxic-native-error',
          ).length,
      )
      .toBe(1);
    await proof.audit(
      '04-thrown-lookalike',
      'A thrown fetch-lookalike remains a native exception; no driver errors are waived',
      [
        {
          id: 'native-lookalike-observed',
          passed:
            events.filter(
              (event) =>
                event.stage === 'throw-fetch-lookalike' && event.kind === 'arxic-native-error',
            ).length === 1,
          values: {
            nativeErrors: events.filter(
              (event) =>
                event.stage === 'throw-fetch-lookalike' && event.kind === 'arxic-native-error',
            ).length,
            driverErrors: events.filter(
              (event) =>
                event.stage === 'throw-fetch-lookalike' && event.kind === 'driver-fetch-load',
            ).length,
          },
        },
      ],
    );
  } finally {
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      const bytes = JSON.stringify(events, null, 2);
      await writeFile(join(evidence, 'navigation-events.json'), bytes);
      await writeFile(
        join(evidence, 'navigation-events.sanitization.json'),
        JSON.stringify(
          {
            sha256: createHash('sha256').update(bytes).digest('hex'),
            method:
              'closed event/stage/endpoint categories and ordinal only; no URLs, payloads, credentials or raw stacks',
            rawTraceRetained: false,
          },
          null,
          2,
        ),
      );
    }
    await proof.finish();
    await browser.close();
    await app?.close();
    await wb.close();
    await stopApp(target.child);
    await rm(target.runtimeDirectory, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);
