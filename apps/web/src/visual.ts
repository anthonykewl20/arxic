import { sha256 as digest } from '@arxic/contracts';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import sharp from 'sharp';
import pixelmatch from 'pixelmatch';
import { captureMaskedViewport } from '@arxic/playwright-screenshot-privacy';
import type { Capture, Project, Run, RunResult } from './types';
import { collectVisualScene, assessVisualScene } from './visual-oracle';

export { digest };

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;
type Timeline = Array<{ action: string; checkpoint: number; result?: string }>;

/** Same-origin only; mutations are denied except during the sign-in submission. */
async function openContext(
  browser: Browser,
  project: Project,
  viewport: { width: number; height: number },
  options: { storageState?: StorageState; allowMutations?: boolean; videoDirectory?: string },
) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    ...(options.storageState ? { storageState: options.storageState } : {}),
    ...(options.videoDirectory
      ? { recordVideo: { dir: options.videoDirectory, size: viewport } }
      : {}),
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
): Promise<string[]> {
  const { context } = await openContext(browser, project, project.viewports[0], { storageState });
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

/** One form sign-in per run. Fields resolve by label, then by input type; values never enter the timeline. */
async function signIn(
  browser: Browser,
  project: Project,
  credentials: { email: string; password: string },
  timeline: Timeline,
): Promise<{ state: StorageState } | { reason: string }> {
  const login = project.login!;
  const { context } = await openContext(browser, project, project.viewports[0], {
    allowMutations: true,
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

export async function captureVisual(run: Run, directory: string): Promise<RunResult> {
  const project = run.project;
  if (!project.origin || !project.captureConsent)
    return {
      outcome: 'blocked',
      summary:
        'Set a target origin and confirm that screenshot capture is authorized for test data.',
    };
  const browser = await chromium.launch({ headless: true });
  const captures: Capture[] = [];
  const findings: NonNullable<RunResult['findings']> = [];
  let blocked = false;
  const timeline: Timeline = [];
  const videoDirectory = join(directory, 'video');
  if (project.recordVideo) await mkdir(videoDirectory, { recursive: true, mode: 0o700 });
  const writeTimeline = async () => {
    const bytes = JSON.stringify(timeline);
    await writeFile(join(directory, 'timeline.json'), bytes, { mode: 0o600 });
    await writeFile(
      join(directory, 'timeline.sanitization.json'),
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
      const outcome = await signIn(browser, project, { email, password }, timeline);
      if ('reason' in outcome) {
        timeline.push({ action: 'sign-in-form', checkpoint: 0, result: 'failed' });
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
      discoveredPaths = await crawl(browser, project, storageState, timeline);
      paths = [...new Set([...project.paths, ...discoveredPaths])].slice(0, project.maxPages);
    }
    const budget = Math.max(1, Math.floor(600 / project.viewports.length));
    if (paths.length > budget) {
      findings.push({
        path: '*',
        kind: 'capture-budget-truncated-pages',
        count: paths.length - budget,
      });
      paths = paths.slice(0, budget);
    }
    for (const viewport of project.viewports)
      for (const path of paths) {
        const { context, counters } = await openContext(browser, project, viewport, {
          storageState,
          videoDirectory: project.recordVideo ? videoDirectory : undefined,
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
        try {
          const checkpoint = captures.length;
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
          await page.locator('body').waitFor({ state: 'visible' });
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
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
          let scene = await collectVisualScene(page);
          for (let attempt = 0; attempt < 6; attempt++) {
            const before = await collectVisualScene(page);
            bytes = await captureMaskedViewport(page, {
              automaticMasks: ['input,textarea,[contenteditable="true"]'],
              requiredMasks: project.masks,
            });
            scene = await collectVisualScene(page);
            if (previous?.equals(bytes) && JSON.stringify(before) === JSON.stringify(scene)) {
              stable = true;
              break;
            }
            previous = bytes;
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
          const id = `checkpoint-${checkpoint + 1}`;
          const file = `${id}.png`;
          const specHash = digest(
            JSON.stringify({
              origin: project.origin,
              path,
              viewport,
              masks: project.masks,
              browser: browser.version(),
              platform: process.platform,
              policy: 'web-visual-v1-input-masks',
              authenticated: !!storageState,
            }),
          );
          await writeFile(join(directory, file), bytes, { mode: 0o600 });
          await writeFile(
            join(directory, `${file}.privacy.json`),
            JSON.stringify({
              schemaVersion: 1,
              screenshotSha256: digest(bytes),
              captureMode: 'viewport-input-masked',
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
          const assessmentBytes = JSON.stringify({
            profile: 'arxic-layout-evidence-v1',
            checkpoint: id,
            browserVersion: browser.version(),
            scene,
            assessment,
          });
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
          findings.push({ path, kind: 'capture-blocked-check-target-and-privacy-masks', count: 1 });
          timeline.push({
            action: 'capture-refused',
            checkpoint: captures.length,
            result: 'blocked',
          });
        } finally {
          const video = page.video();
          await context.close();
          if (video && captures.length) {
            const capture = captures[captures.length - 1];
            if (capture.path === path && !capture.videoFile) {
              const file = `${capture.id}.webm`;
              try {
                await rename(await video.path(), join(directory, file));
                capture.videoFile = file;
                timeline.push({
                  action: 'video-recorded-unmasked',
                  checkpoint: captures.length - 1,
                });
              } catch {
                findings.push({ path, kind: 'video-recording-failed', count: 1 });
              }
            }
          }
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

export async function compareCapture(
  currentPath: string,
  baselinePath: string,
  outputPath: string,
) {
  const current = await sharp(await readFile(currentPath), { limitInputPixels: 1920 * 1200 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const baseline = await sharp(await readFile(baselinePath), { limitInputPixels: 1920 * 1200 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (current.info.width !== baseline.info.width || current.info.height !== baseline.info.height)
    throw new Error('Baseline dimensions changed');
  const { width, height } = current.info;
  const diff = Buffer.alloc(width * height * 4);
  const changedPixels = pixelmatch(baseline.data, current.data, diff, width, height, {
    threshold: 0.1,
  });
  await writeFile(
    outputPath,
    await sharp(diff, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer(),
    { mode: 0o600 },
  );
  return { changedPixels, ratio: changedPixels / (width * height) };
}
