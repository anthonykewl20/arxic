import { sha256 as digest } from '@arxic/contracts';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import pixelmatch from 'pixelmatch';
import { captureMaskedViewport } from '@arxic/playwright-screenshot-privacy';
import type { Capture, Run, RunResult } from './types';

export { digest };

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
  const timeline: Array<{ action: string; checkpoint: number; result?: string }> = [];
  try {
    for (const viewport of project.viewports)
      for (const path of project.paths) {
        const context = await browser.newContext({
          viewport,
          deviceScaleFactor: 1,
          locale: 'en-US',
          timezoneId: 'UTC',
          colorScheme: 'light',
          reducedMotion: 'reduce',
          serviceWorkers: 'block',
        });
        let denied = 0;
        let networkErrors = 0;
        let scriptErrors = 0;
        await context.route('**/*', async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.origin !== project.origin || !['GET', 'HEAD'].includes(request.method())) {
            denied++;
            await route.abort();
          } else await route.continue();
        });
        await context.routeWebSocket(/.*/, (socket) => socket.close());
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
          await page.locator('body').waitFor({ state: 'visible' });
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          const defects = await page.evaluate(() => ({
            overflow: Number(document.documentElement.scrollWidth > window.innerWidth + 1),
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
            ['horizontal-overflow', defects.overflow],
            ['broken-images', defects.brokenImages],
            ['unlabeled-inputs', defects.unlabeledInputs],
          ] as const)
            if (count) findings.push({ path, kind, count });
          let previous: Buffer | undefined;
          let bytes: Buffer = Buffer.alloc(0);
          let stable = false;
          for (let attempt = 0; attempt < 6; attempt++) {
            bytes = await captureMaskedViewport(page, {
              automaticMasks: ['input,textarea,[contenteditable="true"]'],
              requiredMasks: project.masks,
            });
            if (previous?.equals(bytes)) {
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
            }),
          );
          await writeFile(join(directory, file), bytes, { mode: 0o600 });
          await writeFile(
            join(directory, `${file}.privacy.json`),
            JSON.stringify({
              schemaVersion: 1,
              screenshotSha256: digest(bytes),
              captureMode: 'viewport-input-masked',
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
          captures.push({
            id,
            path,
            viewport,
            file,
            sha256: digest(bytes),
            specHash,
            browserVersion: browser.version(),
            status: stable ? 'needs-baseline' : 'unstable',
          });
          timeline.push({
            action: 'capture-input-masked-viewport',
            checkpoint,
            result: stable ? 'stable' : 'unstable',
          });
          if (denied) findings.push({ path, kind: 'blocked-network-requests', count: denied });
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
          await context.close();
        }
      }
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
    return {
      outcome:
        blocked || captures.some((capture) => capture.status === 'unstable')
          ? 'blocked'
          : 'observed',
      summary: `${captures.length} viewport checkpoints captured. Visual baseline review is separate from business-logic verification.`,
      captures,
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
