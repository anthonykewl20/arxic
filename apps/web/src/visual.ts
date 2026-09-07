import { planVisualMatrix } from './visual-matrix';
import { sha256 as digest } from '@arxic/contracts';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import sharp from 'sharp';
import { comparePixels } from './visual-pixels';
import { captureMaskedViewport } from '@arxic/playwright-screenshot-privacy';
import type {
  Capture,
  CaptureFailurePhase,
  Project,
  Run,
  RunResult,
  VisualEnvironment,
} from './types';
import { collectVisualScene, assessVisualScene } from './visual-oracle';

export { digest };

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;
type Timeline = Array<{
  action: string;
  checkpoint: number;
  result?: string;
  environment?: VisualEnvironment;
}>;

/** Same-origin only; mutations are denied except during the sign-in submission. */
async function openContext(
  browser: Browser,
  project: Project,
  viewport: { width: number; height: number },
  options: {
    storageState?: StorageState;
    allowMutations?: boolean;
    colorScheme?: VisualEnvironment['colorScheme'];
    deviceScaleFactor?: VisualEnvironment['deviceScaleFactor'];
  },
) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: options.deviceScaleFactor ?? 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: options.colorScheme ?? 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    ...(options.storageState ? { storageState: options.storageState } : {}),
  });
  const counters = { denied: 0 };
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      url.origin !== project.origin ||
      (!options.allowMutations && !['GET', 'HEAD'].includes(request.method()))
    ) {
      counters.denied++;
      await route.abort();
    } else await route.continue();
  });
  await context.routeWebSocket(/.*/, (socket) => socket.close());
  return { context, counters };
}

const excludedPath =
  /(^|\/)(logout|log-out|signout|sign-out|signoff|api)(\/|$)|\.(png|jpe?g|gif|svg|webp|ico|css|js|map|pdf|zip|xml|txt|woff2?)$/iu;
/** Follow same-origin links from the configured paths, GET only, breadth-first, within the budget. */
async function crawl(
  browser: Browser,
  project: Project,
  storageState: StorageState | undefined,
  timeline: Timeline,
  environment: VisualEnvironment,
): Promise<string[]> {
  const { context } = await openContext(browser, project, project.viewports[0], {
    storageState,
    colorScheme: environment.colorScheme,
    deviceScaleFactor: environment.deviceScaleFactor,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const seen = new Set(project.paths);
  const found: string[] = [];
  const queue = project.paths.map((path) => ({ path, depth: 0 }));
  const loginPath = project.login?.loginPath;
  let visited = 0;
  try {
    while (queue.length && seen.size < project.maxPages) {
      const { path, depth } = queue.shift()!;
      if (depth >= project.maxDepth) continue;
      visited++;
      let links: string[] = [];
      try {
        const response = await page.goto(`${project.origin}${path}`, {
          waitUntil: 'load',
          timeout: 20_000,
        });
        const landed = new URL(page.url());
        if (!response?.ok() || landed.origin !== project.origin) continue;
        if (loginPath && path !== loginPath && landed.pathname.startsWith(loginPath)) continue;
        await page.waitForTimeout(300);
        links = await page.evaluate(() =>
          [...document.querySelectorAll('a[href]')].map(
            (anchor) => (anchor as HTMLAnchorElement).href,
          ),
        );
      } catch {
        continue;
      }
      for (const href of links) {
        let url: URL;
        try {
          url = new URL(href);
        } catch {
          continue;
        }
        if (url.origin !== project.origin) continue;
        const candidate = url.pathname.replace(/\/+$/u, '') || '/';
        if (seen.has(candidate) || excludedPath.test(candidate) || /[\s\\]/u.test(candidate))
          continue;
        if (loginPath && candidate.startsWith(loginPath)) continue;
        seen.add(candidate);
        found.push(candidate);
        queue.push({ path: candidate, depth: depth + 1 });
        if (seen.size >= project.maxPages) break;
      }
    }
  } finally {
    await context.close();
  }
  timeline.push({
    action: 'crawl-same-origin-links',
    checkpoint: 0,
    result: `${visited} visited, ${found.length} found`,
  });
  return found;
}

/** One form sign-in per browser family in a run. Fields resolve by label, then by input type; values never enter the timeline. */
async function signIn(
  browser: Browser,
  project: Project,
  credentials: { email: string; password: string },
  timeline: Timeline,
  environment: VisualEnvironment,
): Promise<{ state: StorageState } | { reason: string }> {
  const login = project.login!;
  const { context } = await openContext(browser, project, project.viewports[0], {
    allowMutations: true,
    colorScheme: environment.colorScheme,
    deviceScaleFactor: environment.deviceScaleFactor,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  try {
    const response = await page.goto(`${project.origin}${login.loginPath}`, {
      waitUntil: 'load',
      timeout: 20_000,
    });
    if (!response?.ok())
      return { reason: `Login page returned ${response?.status() ?? 'no response'}` };
    const locate = async (labelled: ReturnType<Page['getByLabel']>, fallback: string) => {
      const byLabel = labelled.locator('visible=true');
      if ((await byLabel.count()) > 0) return { locator: byLabel.first(), how: 'label' };
      const byType = page.locator(fallback).locator('visible=true');
      if ((await byType.count()) > 0) return { locator: byType.first(), how: 'type' };
      return null;
    };
    const email = await locate(
      page.getByLabel(login.emailLabel, { exact: false }),
      'input[type="email"], input[autocomplete="username"], input[name*="email" i], input[name*="user" i]',
    );
    const password = await locate(
      page.getByLabel(login.passwordLabel, { exact: false }),
      'input[type="password"]',
    );
    if (!email || !password)
      return { reason: 'Email or password field not found on the login page' };
    await email.locator.fill(credentials.email);
    await password.locator.fill(credentials.password);
    const submitByLabel = page.getByRole('button', { name: login.submitLabel, exact: false });
    const submit =
      (await submitByLabel.count()) > 0
        ? submitByLabel.first()
        : page.locator('button[type="submit"], input[type="submit"]').first();
    if ((await submit.count()) === 0)
      return { reason: 'Submit button not found on the login page' };
    await submit.click();
    await page
      .waitForURL((url) => !url.pathname.startsWith(login.loginPath), { timeout: 20_000 })
      .catch(() => undefined);
    await page.waitForLoadState('load').catch(() => undefined);
    const landed = new URL(page.url());
    if (landed.origin !== project.origin || landed.pathname.startsWith(login.loginPath))
      return { reason: 'Still on the login page after submitting; check the secrets and labels' };
    timeline.push({
      action: 'sign-in-form',
      checkpoint: 0,
      result: `fields by ${email.how}/${password.how}`,
    });
    return { state: await context.storageState() };
  } catch (error) {
    return { reason: error instanceof Error ? error.message.split('\n')[0] : 'Sign-in failed' };
  } finally {
    await context.close();
  }
}

async function captureEnvironment(
  run: Run,
  directory: string,
  environment: VisualEnvironment,
  pageBudget: number,
  prefix: string,
  signIns: Map<VisualEnvironment['browser'], Awaited<ReturnType<typeof signIn>>>,
): Promise<RunResult> {
  const project = run.project;
  if (!project.origin || !project.captureConsent)
    return {
      outcome: 'blocked',
      summary:
        'Set a target origin and confirm that screenshot capture is authorized for test data.',
    };
  if (project.recordVideo)
    return {
      outcome: 'blocked',
      summary:
        'Unmasked video recording is unavailable. Turn off video to use masked screenshots and the sanitized action timeline.',
    };
  const browser = await { chromium, firefox, webkit }[environment.browser].launch({
    headless: true,
    ...(environment.renderer === 'chromium-full-headless' ? { channel: 'chromium' } : {}),
  });
  const captures: Capture[] = [];
  const findings: NonNullable<RunResult['findings']> = [];
  let blocked = false;
  const timeline: Timeline = [];
  const writeTimeline = async () => {
    const bytes = JSON.stringify(timeline);
    await writeFile(join(directory, `${prefix}timeline.json`), bytes, { mode: 0o600 });
    await writeFile(
      join(directory, `${prefix}timeline.sanitization.json`),
      JSON.stringify({
        schemaVersion: 1,
        sha256: digest(bytes),
        method:
          'allow-listed action and ordinal fields only; no DOM, network payloads, credentials or trace recording',
        rawTraceRetained: false,
      }),
      { mode: 0o600 },
    );
  };
  let storageState: StorageState | undefined;
  let discoveredPaths: string[] | undefined;
  let paths = project.paths;
  try {
    if (project.login) {
      const email = process.env[project.login.emailRef];
      const password = process.env[project.login.passwordRef];
      if (!email || !password) {
        await writeTimeline();
        return {
          outcome: 'blocked',
          summary: `Sign-in secrets ${project.login.emailRef} and ${project.login.passwordRef} must be set in the server environment.`,
          findings: [{ path: project.login.loginPath, kind: 'login-secrets-missing', count: 1 }],
        };
      }
      let outcome = signIns.get(environment.browser);
      const reused = !!outcome;
      if (!outcome) {
        outcome = await signIn(browser, project, { email, password }, timeline, environment);
        signIns.set(environment.browser, outcome);
      } else {
        timeline.push({
          action: 'reuse-browser-sign-in',
          checkpoint: 0,
          result: 'state' in outcome ? 'in-memory state from this run' : 'prior sign-in failed',
        });
      }
      if ('reason' in outcome) {
        if (!reused) timeline.push({ action: 'sign-in-form', checkpoint: 0, result: 'failed' });
        await writeTimeline();
        return {
          outcome: 'blocked',
          summary: `Sign-in failed: ${outcome.reason}`,
          findings: [{ path: project.login.loginPath, kind: 'login-failed', count: 1 }],
        };
      }
      storageState = outcome.state;
    }
    if (project.pageMode === 'discover') {
      discoveredPaths = await crawl(browser, project, storageState, timeline, environment);
      paths = [...new Set([...project.paths, ...discoveredPaths])].slice(0, project.maxPages);
    }
    const budget = pageBudget;
    if (paths.length > budget) {
      findings.push({
        path: '*',
        kind: 'capture-budget-truncated-pages',
        count: paths.length - budget,
      });
      paths = paths.slice(0, budget);
    }
    // Reserve identity per attempted checkpoint; a failed write must not poison the next page.
    let nextCheckpoint = 0;
    for (const viewport of project.viewports)
      for (const path of paths) {
        const checkpoint = nextCheckpoint++;
        const { context, counters } = await openContext(browser, project, viewport, {
          storageState,
          colorScheme: environment.colorScheme,
          deviceScaleFactor: environment.deviceScaleFactor,
        });
        let networkErrors = 0;
        let scriptErrors = 0;
        const page = await context.newPage();
        page.setDefaultTimeout(15_000);
        page.on('pageerror', () => {
          scriptErrors++;
        });
        page.on('response', (response) => {
          if (response.status() >= 400) networkErrors++;
        });
        let failurePhase: CaptureFailurePhase = 'navigation';
        try {
          timeline.push({ action: 'navigate', checkpoint });
          const response = await page.goto(`${project.origin}${path}`, {
            waitUntil: 'load',
            timeout: 20_000,
          });
          if (!response?.ok() || new URL(page.url()).origin !== project.origin)
            throw new Error('Target navigation failed');
          if (
            project.login &&
            path !== project.login.loginPath &&
            new URL(page.url()).pathname.startsWith(project.login.loginPath)
          )
            findings.push({ path, kind: 'redirected-to-login', count: 1 });
          failurePhase = 'readiness';
          await page.locator('body').waitFor({ state: 'visible' });
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          failurePhase = 'measurement';
          const defects = await page.evaluate(() => ({
            brokenImages: [...document.images].filter(
              (image) => image.complete && image.naturalWidth === 0 && image.getAttribute('src'),
            ).length,
            unlabeledInputs: [
              ...document.querySelectorAll(
                'input:not([type="hidden"]):not([type="submit"]):not([type="button"]),textarea,select',
              ),
            ].filter(
              (element) =>
                !(element as HTMLInputElement).labels?.length &&
                !element.getAttribute('aria-label') &&
                !element.getAttribute('aria-labelledby') &&
                !element.getAttribute('title'),
            ).length,
          }));
          for (const [kind, count] of [
            ['broken-images', defects.brokenImages],
            ['unlabeled-inputs', defects.unlabeledInputs],
          ] as const)
            if (count) findings.push({ path, kind, count });
          let previous: Buffer | undefined;
          let bytes: Buffer = Buffer.alloc(0);
          let stable = false;
          let scene = await collectVisualScene(page, [
            'input,textarea,[contenteditable="true"]',
            ...project.masks,
          ]);
          for (let attempt = 0; attempt < 6; attempt++) {
            failurePhase = 'measurement';
            const before = await collectVisualScene(page, [
              'input,textarea,[contenteditable="true"]',
              ...project.masks,
            ]);
            failurePhase = 'privacy-capture';
            bytes = await captureMaskedViewport(page, {
              automaticMasks: ['input,textarea,[contenteditable="true"]'],
              requiredMasks: project.masks,
              scale: 'device',
            });
            failurePhase = 'measurement';
            scene = await collectVisualScene(page, [
              'input,textarea,[contenteditable="true"]',
              ...project.masks,
            ]);
            if (previous?.equals(bytes) && JSON.stringify(before) === JSON.stringify(scene)) {
              stable = true;
              break;
            }
            previous = bytes;
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
          const id = `${prefix}checkpoint-${checkpoint + 1}`;
          const file = `${id}.png`;
          const specHash = digest(
            JSON.stringify({
              origin: project.origin,
              path,
              viewport,
              masks: project.masks,
              browser: browser.version(),
              ...(environment.browser === 'chromium' &&
              environment.colorScheme === 'light' &&
              !environment.deviceScaleFactor
                ? {}
                : { environment }),
              platform: process.platform,
              policy: 'web-visual-v1-input-masks',
              authenticated: !!storageState,
              login: project.login ?? null,
            }),
          );
          failurePhase = 'evidence-write';
          await writeFile(join(directory, file), bytes, { mode: 0o600 });
          await writeFile(
            join(directory, `${file}.privacy.json`),
            JSON.stringify({
              schemaVersion: 1,
              screenshotSha256: digest(bytes),
              captureMode: 'viewport-input-masked',
              pngNormalization:
                'validated-sRGB-and-full-precision-sBIT-removed-pixel-chunks-unchanged',
              authenticated: !!storageState,
              automaticMasks: ['input', 'textarea', '[contenteditable="true"]'],
              additionalMasks: project.masks,
              authority: {
                kind: 'administrator-project-setting',
                projectId: project.id,
                captureConsent: true,
              },
              humanInspection: 'required-before-external-sharing',
              rawTraceRetained: false,
            }),
            { mode: 0o600 },
          );
          const assessmentFile = `${id}.assessment.json`;
          failurePhase = 'measurement';
          const assessment = assessVisualScene(scene, {
            screenshotSha256: digest(bytes),
            stable,
          });
          if (
            assessment.checks.some(
              (check) => check.id === 'document-horizontal-overflow' && check.verdict === 'fail',
            )
          )
            findings.push({ path, kind: 'horizontal-overflow', count: 1 });
          const contrastFailures = assessment.checks.filter(
            (check) => check.id.startsWith('text-contrast-') && check.verdict === 'fail',
          ).length;
          if (contrastFailures)
            findings.push({ path, kind: 'text-contrast', count: contrastFailures });
          const assessmentBytes = JSON.stringify({
            profile: 'arxic-layout-text-evidence-v2',
            checkpoint: id,
            browserVersion: browser.version(),
            environment,
            scene,
            assessment,
          });
          failurePhase = 'evidence-write';
          await writeFile(join(directory, assessmentFile), assessmentBytes, { mode: 0o600 });
          captures.push({
            assessmentFile,
            assessmentSha256: digest(assessmentBytes),
            id,
            path,
            viewport,
            file,
            sha256: digest(bytes),
            specHash,
            browserVersion: browser.version(),
            environment,
            status: stable ? 'needs-baseline' : 'unstable',
            ...(storageState ? { authenticated: true } : {}),
          });
          timeline.push({
            action: 'capture-input-masked-viewport',
            checkpoint,
            result: stable ? 'stable' : 'unstable',
          });
          if (counters.denied)
            findings.push({ path, kind: 'blocked-network-requests', count: counters.denied });
          if (networkErrors) findings.push({ path, kind: 'http-errors', count: networkErrors });
          if (scriptErrors) findings.push({ path, kind: 'script-errors', count: scriptErrors });
        } catch {
          blocked = true;
          findings.push({
            path,
            kind: 'capture-blocked-check-target-and-privacy-masks',
            count: 1,
            failurePhase,
          });
          timeline.push({
            action: 'capture-refused',
            checkpoint,
            result: 'blocked',
          });
        } finally {
          await context.close();
        }
      }
    await writeTimeline();
    return {
      outcome:
        blocked || captures.some((capture) => capture.status === 'unstable')
          ? 'blocked'
          : 'observed',
      summary: `${captures.length} viewport checkpoints captured across ${paths.length} pages${
        storageState ? ' after sign-in' : ''
      }${discoveredPaths ? `; crawl found ${discoveredPaths.length} additional pages` : ''}. Visual baseline review is separate from business-logic verification.`,
      captures,
      ...(discoveredPaths ? { discoveredPaths } : {}),
      findings,
    };
  } finally {
    await browser.close();
  }
}

/** Expand the declared matrix; each environment is independent and failure stays visible. */
export async function captureVisual(run: Run, directory: string): Promise<RunResult> {
  const { environments, pageBudget } = planVisualMatrix(run.project);
  const captures: Capture[] = [];
  const findings: NonNullable<RunResult['findings']> = [];
  const visualEnvironments: NonNullable<RunResult['visualEnvironments']> = [];
  const discoveredPaths = new Set<string>();
  const timeline: Timeline = [];
  // Authentication is run-local; matrix expansion must not repeatedly submit the same login.
  const signIns = new Map<VisualEnvironment['browser'], Awaited<ReturnType<typeof signIn>>>();
  let singleSummary = '';
  for (const environment of environments) {
    const prefix =
      environments.length === 1
        ? ''
        : `${environment.browser}-${environment.colorScheme}${environment.deviceScaleFactor ? `-${environment.deviceScaleFactor}x` : ''}-`;
    let result: RunResult;
    try {
      result = await captureEnvironment(run, directory, environment, pageBudget, prefix, signIns);
      if (run.project.origin && run.project.captureConsent && !run.project.recordVideo) {
        const steps = JSON.parse(
          await readFile(join(directory, `${prefix}timeline.json`), 'utf8'),
        ) as Timeline;
        timeline.push(...steps.map((step) => ({ ...step, environment })));
      }
    } catch {
      result = {
        outcome: 'blocked',
        summary:
          'Environment could not start or complete. Check the installed Playwright browser and system dependencies.',
      };
      timeline.push({
        action: 'environment-refused',
        checkpoint: 0,
        result: 'blocked',
        environment,
      });
    }
    singleSummary = result.summary;
    captures.push(...(result.captures ?? []));
    findings.push(
      ...(result.findings ?? []).map((finding) =>
        environments.length > 1 ? { ...finding, environment } : finding,
      ),
    );
    for (const path of result.discoveredPaths ?? []) discoveredPaths.add(path);
    const omittedPages = (result.findings ?? [])
      .filter((f) => f.kind === 'capture-budget-truncated-pages')
      .reduce((sum, f) => sum + f.count, 0);
    visualEnvironments.push({
      ...environment,
      outcome: result.outcome === 'blocked' ? 'blocked' : 'observed',
      captures: result.captures?.length ?? 0,
      ...(omittedPages ? { omittedPages } : {}),
      ...(result.outcome === 'blocked' ? { reason: result.summary } : {}),
    });
  }
  const bytes = JSON.stringify(timeline);
  await writeFile(join(directory, 'timeline.json'), bytes, { mode: 0o600 });
  await writeFile(
    join(directory, 'timeline.sanitization.json'),
    JSON.stringify({
      schemaVersion: 1,
      sha256: digest(bytes),
      method:
        'allow-listed action, ordinal and bounded environment fields; no DOM/network/credential payloads',
      rawTraceRetained: false,
    }),
    { mode: 0o600 },
  );
  return {
    outcome: visualEnvironments.some((cell) => cell.outcome === 'blocked') ? 'blocked' : 'observed',
    summary:
      environments.length === 1
        ? singleSummary
        : `${captures.length} viewport checkpoints captured across ${environments.length} ${environments.some((cell) => cell.deviceScaleFactor) ? 'browser/theme/pixel-density' : 'browser/theme'} environments. Visual baseline review is separate from business-logic verification.`,
    captures,
    findings,
    visualEnvironments,
    ...(discoveredPaths.size ? { discoveredPaths: [...discoveredPaths] } : {}),
  };
}

export async function compareCapture(
  currentPath: string,
  baselinePath: string,
  outputPath: string,
  deviceScaleFactor: 1 | 2 | 3 = 1,
) {
  if (![1, 2, 3].includes(deviceScaleFactor)) throw new Error('Unsupported comparison pixel ratio');
  const limitInputPixels = Math.min(16 * 1024 * 1024, 1920 * 1200 * deviceScaleFactor ** 2);
  const current = await sharp(await readFile(currentPath), { limitInputPixels })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const baseline = await sharp(await readFile(baselinePath), { limitInputPixels })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (current.info.width !== baseline.info.width || current.info.height !== baseline.info.height)
    throw new Error('Baseline dimensions changed');
  const { width, height } = current.info;
  const { diff, changedPixels } = comparePixels(baseline.data, current.data, width, height);
  await writeFile(
    outputPath,
    await sharp(diff, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer(),
    { mode: 0o600 },
  );
  return { changedPixels, ratio: changedPixels / (width * height) };
}
