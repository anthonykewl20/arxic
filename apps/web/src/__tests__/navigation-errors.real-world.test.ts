import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { startWorkbench } from './workbench-runtime';
import { launchDashboardBrowser } from './dashboard-browser';
import { dashboardProof } from './dashboard-proof';
import { isFetchLoadShape, trackDashboardErrors } from './dashboard-errors';

const ADMIN_TOKEN = 'navigation-classifier-proof-token-32-characters';

// #447: prove the corroborated outgoing-document fetch classification on the
// engines that can produce each behavior. WebKit reproduces the teardown
// diagnostic; Chromium/Firefox teardown stays silent. Active-page failures and
// thrown look-alikes must remain hard errors on every engine.
it('classifies outgoing-document fetch diagnostics without waiving active failures', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const state = await mkdtemp(join(tmpdir(), 'navigation-classifier-'));
  let app: Awaited<ReturnType<typeof startWorkbench>> | undefined;
  const browser = await launchDashboardBrowser();
  const engine = browser.browserType().name();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors = trackDashboardErrors(page);
  const evidence = process.env.ARXIC_NAVIGATION_EVIDENCE_DIR
    ? join(process.env.ARXIC_NAVIGATION_EVIDENCE_DIR, engine)
    : undefined;
  const proof = dashboardProof(page, evidence);
  try {
    app = await startWorkbench({
      roots: [root],
      stateDirectory: state,
      port: 0,
      adminToken: ADMIN_TOKEN,
    });
    await page.goto(app.origin);
    await page.getByLabel('Administrator token').fill(ADMIN_TOKEN);
    await page.getByRole('button', { name: 'Open workbench' }).click();
    await page.locator('#app').waitFor();
    await proof.audit('01-signed-in', 'Real session is established before any stimulus');

    // Teardown stimulus: fetches initiated inside the document-destruction
    // window. WebKit converts them to access-control fetch-load console
    // errors, which the driver reports as pageerror. A run that reproduces
    // none on WebKit is inconclusive and fails — it never passes silently.
    let reproduced = 0;
    for (let round = 0; round < 12 && reproduced === 0; round++) {
      const before = errors.events().length;
      await page.evaluate(() => {
        let tick = 0;
        const timer = setInterval(() => {
          if (++tick > 400) clearInterval(timer);
          else void fetch(`/api/state?stimulus=${tick}`).catch(() => {});
        }, 4);
        setTimeout(() => location.reload(), 60);
      });
      await page.locator('#app').waitFor();
      await page.waitForTimeout(200);
      reproduced = errors
        .events()
        .slice(before)
        .filter(
          (event) =>
            event.kind === 'outgoing-document-fetch' ||
            (event.kind === 'hard' && isFetchLoadShape(event.name, event.message)),
        ).length;
    }
    const waivedAfterStimulus = errors.waived().length;
    const fetchLoadHardAfterStimulus = errors
      .hard()
      .filter((event) => isFetchLoadShape(event.name, event.message)).length;
    await proof.audit(
      '02-teardown-stimulus',
      'Fetches initiated during document teardown are classified, not waived blindly',
      [
        {
          id: engine === 'webkit' ? 'teardown-diagnostic-reproduced' : 'teardown-silent',
          passed: engine === 'webkit' ? reproduced > 0 : reproduced === 0,
          values: { reproduced, waived: waivedAfterStimulus },
        },
      ],
    );
    if (engine === 'webkit') {
      expect(reproduced, 'non-reproducing WebKit run is inconclusive, not a pass').toBeGreaterThan(
        0,
      );
      expect(fetchLoadHardAfterStimulus).toBe(0);
      expect(waivedAfterStimulus).toBeGreaterThan(0);
    } else {
      expect(reproduced).toBe(0);
      expect(errors.hard()).toEqual([]);
    }

    // Lifecycle: the reloaded document still serves real navigation and data.
    await page.getByRole('button', { name: 'Test runs', exact: true }).click();
    await page.getByRole('heading', { name: 'No runs yet' }).waitFor();
    await page.waitForTimeout(2100); // clear the corroboration window

    // Active-page request refusal: same driver shape on WebKit, but no
    // outgoing document — must stay a hard error everywhere.
    await page.route('**/api/runs?**', (route) => route.abort('accessdenied'));
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.getByRole('button', { name: 'Test runs', exact: true }).click();
    await page
      .getByText('Run history could not be loaded. Retry or check your connection.', {
        exact: true,
      })
      .waitFor();
    await page.waitForTimeout(400);
    await page.unroute('**/api/runs?**');
    const refusalEvents = errors
      .hard()
      .filter((event) => isFetchLoadShape(event.name, event.message));
    await proof.audit(
      '03-active-refusal',
      'An active-page request refusal stays an error on every engine',
      [
        {
          id: 'active-refusal-hard',
          passed: engine === 'webkit' ? refusalEvents.length > 0 : refusalEvents.length === 0,
          values: { fetchLoadHard: refusalEvents.length },
        },
      ],
    );
    if (engine === 'webkit') expect(refusalEvents.length).toBeGreaterThan(0);
    else expect(refusalEvents.length).toBe(0);
    const waivedAfterRefusal = errors.waived().length;
    expect(waivedAfterRefusal).toBe(waivedAfterStimulus);
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.getByRole('button', { name: 'Test runs', exact: true }).click();
    await page.getByRole('heading', { name: 'No runs yet' }).waitFor();
    await page.waitForTimeout(2100);

    // Thrown fetch-look-alike on an active page: exact driver shape plus a
    // native error — never waivable, on every engine.
    await page.evaluate(() => {
      setTimeout(() => {
        const error = new Error('//local.invalid/api/runs due to access control checks.');
        error.name = 'Fetch API cannot load http';
        throw error;
      }, 0);
    });
    await expect
      .poll(
        () => errors.hard().filter((event) => isFetchLoadShape(event.name, event.message)).length,
      )
      .toBeGreaterThan(0);
    await proof.audit('04-thrown-lookalike', 'A thrown fetch-lookalike stays a hard error', [
      {
        id: 'lookalike-hard',
        passed:
          errors.hard().filter((event) => isFetchLoadShape(event.name, event.message)).length > 0,
        values: { lookalikeHard: 1 },
      },
    ]);
    expect(errors.waived().length).toBe(waivedAfterStimulus);

    // Plain native canary: unrelated to fetch shape, always hard.
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('arxic-canary-window');
      }, 0);
    });
    await expect
      .poll(
        () => errors.hard().filter((event) => event.message.includes('arxic-canary-window')).length,
      )
      .toBeGreaterThan(0);
    await proof.audit('05-native-canary', 'An unrelated native error stays hard');
    expect(errors.waived().length).toBe(waivedAfterStimulus);
  } finally {
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      const bytes = JSON.stringify(
        {
          engine,
          events: errors
            .events()
            .map((event) =>
              event.kind === 'hard'
                ? { kind: 'hard', name: event.name }
                : { kind: event.kind, endpoint: event.endpoint },
            ),
          trace: errors.trace(),
        },
        null,
        2,
      );
      await writeFile(join(evidence, 'navigation-events.json'), bytes);
      await writeFile(
        join(evidence, 'navigation-events.sanitization.json'),
        JSON.stringify(
          {
            sha256: createHash('sha256').update(bytes).digest('hex'),
            method:
              'closed event/trace categories, endpoints and ordinals only; no URLs, payloads, credentials or raw stacks',
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
    await rm(state, { recursive: true, force: true });
  }
}, 240_000);
