import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { chromium, type Locator, type Page } from 'playwright';
import { captureMaskedViewport } from '@arxic/playwright-screenshot-privacy';
import {
  bootFixtureApp,
  referenceAuthApp,
  vulnerableAuthApp,
  stopApp,
} from '../../../../packages/real-world-testkit/src';
import { startWorkbench } from '../server';
import { extractCase } from './features';
import { runTraining, type TrainingRow } from './train-runner';
import { evaluateOracle, validateCorpusPlan, VARIANT_REGISTRY, type FrozenPlan } from './corpus';
import { maskBoxes, measure, save } from './workflow';
import type { Box, Scene, VisualCase } from './evidence';

const execute = promisify(execFile);

export type CorpusV2Manifest = {
  version: 1;
  plan: FrozenPlan;
  revision: string;
  skipped: { family: string; viewport: number; variant: string; reason: string }[];
  cases: {
    manifest: string;
    family: string;
    split: 'train' | 'calibration' | 'test';
    variant: string;
    viewport: number;
    label: 0 | 1;
    labelOrigin: string;
    measuredClip: number;
  }[];
  provenance: string;
};

type FamilySurface = {
  origin: string;
  path: string;
  button: string;
  buttonExact: boolean;
  /** Locators that Chromium's a11y tree cannot name (koel's label-wrapped submit, #383) bind by unique css instead. */
  buttonSelector?: string;
};
type StartedFamily = { surface: FamilySurface; stop: () => Promise<void> };

const THIRD_PARTY_ROOT =
  process.env.ARXIC_VISUAL_THIRD_PARTY ?? '/home/soultransit/devtony/thirdparty-dg';

async function bootDockerFamily(config: {
  image: string;
  containerPrefix: string;
  containerPort: number;
  args: string[];
  mounts: { host: string; container: string }[];
  healthPath: string;
}): Promise<StartedFamily> {
  const container = `${config.containerPrefix}-${randomUUID().slice(0, 8)}`;
  const uid = process.getuid?.() ?? 1000,
    gid = process.getgid?.() ?? 1000;
  const runArgs = [
    'run',
    '-d',
    '--name',
    container,
    '-u',
    `${uid}:${gid}`,
    '-e',
    'HOME=/tmp',
    '-p',
    `127.0.0.1::${config.containerPort}`,
    ...config.mounts.flatMap((m) => ['-v', `${m.host}:${m.container}`]),
    ...config.args,
  ];
  await execute('docker', runArgs, { timeout: 60000 });
  const stop = async () => {
    await execute('docker', ['stop', '-t', '5', container], { timeout: 30000 }).catch(() => {});
    await execute('docker', ['rm', '-f', container], { timeout: 30000 }).catch(() => {});
  };
  try {
    const port = (
      await execute('docker', ['port', container, `${config.containerPort}/tcp`])
    ).stdout
      .trim()
      .split('\n')[0]!
      .replace(/^.*:/u, '');
    const origin = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 120000;
    do {
      try {
        const response = await fetch(`${origin}${config.healthPath}`);
        if (response.ok)
          return { surface: { origin, path: '/', button: '', buttonExact: true }, stop };
      } catch {
        /* container still starting */
      }
      await new Promise((r) => setTimeout(r, 1000));
    } while (Date.now() < deadline);
    throw new Error('family-boot-failed');
  } catch (error) {
    await stop();
    throw error;
  }
}

export async function startFamily(root: string, family: string): Promise<StartedFamily> {
  if (family === 'next' || family === 'express') {
    const fixture = await bootFixtureApp(
      root,
      family === 'next' ? referenceAuthApp : vulnerableAuthApp,
      `visual-corpus-${family}`,
    );
    return {
      surface: {
        origin: fixture.origin,
        path: family === 'next' ? '/login' : '/',
        button: 'Login',
        buttonExact: true,
      },
      stop: async () => {
        await stopApp(fixture.child);
        await rm(fixture.runtimeDirectory, { recursive: true, force: true });
      },
    };
  }
  if (family === 'arxic') {
    const state = await mkdtemp(join(tmpdir(), 'visual-corpus-arxic-'));
    const app = await startWorkbench({
      roots: [root],
      stateDirectory: state,
      adminToken: 'visual-capture-anonymous-only-token',
      port: 0,
    });
    return {
      surface: { origin: app.origin, path: '/', button: 'Open workbench', buttonExact: false },
      stop: async () => {
        await app.close();
        await rm(state, { recursive: true, force: true });
      },
    };
  }
  if (family === 'koel') {
    const started = await bootDockerFamily({
      image: 'koel-php83:rehearsal',
      containerPrefix: 'koel-visual-corpus',
      containerPort: 8123,
      mounts: [
        { host: `${THIRD_PARTY_ROOT}/koel`, container: '/var/www/koel' },
        { host: `${THIRD_PARTY_ROOT}/koel-data`, container: '/data' },
      ],
      args: [
        '-w',
        '/var/www/koel',
        'koel-php83:rehearsal',
        'php',
        'artisan',
        'serve',
        '--host=0.0.0.0',
        '--port=8123',
      ],
      healthPath: '/',
    });
    return {
      surface: {
        ...started.surface,
        path: '/',
        button: 'Log In',
        buttonExact: false,
        buttonSelector: 'form button[type="submit"]',
      },
      stop: started.stop,
    };
  }
  if (family === 'directus') {
    const started = await bootDockerFamily({
      image: 'directus-node22:rehearsal',
      containerPrefix: 'directus-visual-corpus',
      containerPort: 8055,
      mounts: [
        { host: `${THIRD_PARTY_ROOT}/directus`, container: '/repo' },
        { host: `${THIRD_PARTY_ROOT}/directus-data`, container: '/data' },
      ],
      args: [
        '-w',
        '/repo',
        '-e',
        'DB_CLIENT=sqlite3',
        '-e',
        'DB_FILENAME=/data/data.db',
        '-e',
        'SECRET=rehearsal-57ab82b4a0f62432c3329123162c0f02',
        '-e',
        'HOST=0.0.0.0',
        '-e',
        'PORT=8055',
        '-e',
        'EXTENSIONS_PATH=/data/extensions',
        '-e',
        'STORAGE_LOCAL_ROOT=/data/uploads',
        'directus-node22:rehearsal',
        'node',
        'api/dist/cli/run.js',
        'start',
      ],
      healthPath: '/server/ping',
    });
    return {
      surface: { ...started.surface, path: '/admin', button: 'Sign In', buttonExact: false },
      stop: started.stop,
    };
  }
  throw new Error('unknown-family');
}

async function applyVariant(
  button: Locator,
  page: Page,
  variantId: string,
  box: Box,
  viewport: { width: number; height: number },
) {
  const variant = VARIANT_REGISTRY[variantId]!;
  if (variantId === 'clean') return;
  if (variant.clipFull) {
    await button.evaluate((node) => {
      (node as HTMLElement).style.transform = 'translateX(3000px)';
    });
    return;
  }
  if (variant.clipKeep !== undefined) {
    const keep = variant.clipKeep;
    if (variant.clipDirection === 'right') {
      const translate = viewport.width - keep * box.width - box.x;
      await button.evaluate((node, translate: number) => {
        (node as HTMLElement).style.transform = `translateX(${translate}px)`;
      }, translate);
    } else {
      const translate = viewport.height - keep * box.height - box.y;
      await button.evaluate((node, translate: number) => {
        (node as HTMLElement).style.transform = `translateY(${translate}px)`;
      }, translate);
    }
    return;
  }
  if (variantId === 'content-change') {
    // An approved content change must not touch the required control itself:
    // its role-locator identity has to survive for the after-measurement.
    await page.evaluate(() => {
      const text = document.querySelector<HTMLElement>('h1, h2, p');
      if (text) text.textContent = text.textContent === 'Continue' ? 'Proceed' : 'Continue';
    });
    return;
  }
  if (variantId === 'overlay-adjacent') {
    await page.evaluate(() => {
      const banner = document.createElement('div');
      banner.setAttribute('data-visual-corpus', 'overlay-adjacent');
      banner.style.cssText =
        'position:fixed;left:0;top:0;width:96px;height:36px;background:#1f2937;z-index:2147483647;';
      document.body.appendChild(banner);
    });
    return;
  }
  if (variantId === 'style-tweak') {
    await page.evaluate(() => {
      document.body.style.filter = 'brightness(1.02)';
    });
    return;
  }
  throw new Error('unknown-variant');
}

export async function captureCorpusV2(
  root: string,
  output: string,
  families: string[],
  viewports = [360, 640, 1024, 1280],
  variants = Object.keys(VARIANT_REGISTRY),
): Promise<CorpusV2Manifest> {
  const frozen = validateCorpusPlan({
    version: 1,
    families,
    viewports,
    variants,
    allocationSeed: 423,
    criterion: 'required-submit-inside-viewport',
  });
  await mkdir(output, { recursive: true, mode: 0o700 });
  const revision = (await execute('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const manifest: CorpusV2Manifest = {
    version: 1,
    plan: frozen,
    revision,
    skipped: [],
    cases: [],
    provenance:
      'Controlled viewport-clipping regressions plus negative controls across application families; groups never split across train/calibration/test; allocation frozen before training with seed 423.',
  };
  const browser = await chromium.launch({ headless: true });
  try {
    for (const family of frozen.families) {
      const started = await startFamily(root, family);
      const split = frozen.allocation.train.includes(family)
        ? 'train'
        : frozen.allocation.calibration.includes(family)
          ? 'calibration'
          : 'test';
      try {
        for (const width of viewports)
          for (const variantId of variants) {
            const height = 800,
              id = `${family}-${width}-${variantId}`;
            const context = await browser.newContext({
              viewport: { width, height },
              deviceScaleFactor: 1,
              reducedMotion: 'reduce',
              colorScheme: 'light',
              serviceWorkers: 'block',
            });
            const page = await context.newPage();
            try {
              await page.goto(started.surface.origin + started.surface.path);
              const button = started.surface.buttonSelector
                ? page.locator(started.surface.buttonSelector)
                : page.getByRole('button', {
                    name: started.surface.button,
                    exact: started.surface.buttonExact,
                  });
              await button.waitFor({ state: 'visible' });
              if (started.surface.buttonSelector && (await button.count()) !== 1)
                throw new Error('missing-control');
              await page.evaluate(() => document.fonts.ready);
              const beforeMeasurement = await measure(button, width, height);
              if (beforeMeasurement.clip !== 1) {
                manifest.skipped.push({
                  family,
                  viewport: width,
                  variant: variantId,
                  reason: 'baseline-not-inside-viewport',
                });
                continue;
              }
              const beforeMasks = await maskBoxes(page);
              const beforeBytes = await captureMaskedViewport(page, {
                automaticMasks: ['input', 'textarea', '[contenteditable="true"]'],
                requiredMasks: [],
              });
              await applyVariant(button, page, variantId, beforeMeasurement.box!, {
                width,
                height,
              });
              const currentMeasurement = await measure(button, width, height);
              const currentMasks = await maskBoxes(page);
              const currentBytes = await captureMaskedViewport(page, {
                automaticMasks: ['input', 'textarea', '[contenteditable="true"]'],
                requiredMasks: [],
              });
              const repeated = await measure(button, width, height);
              if (
                JSON.stringify(repeated) !== JSON.stringify(currentMeasurement) ||
                JSON.stringify(beforeMasks) !== JSON.stringify(currentMasks)
              ) {
                manifest.skipped.push({
                  family,
                  viewport: width,
                  variant: variantId,
                  reason: 'unstable-case',
                });
                continue;
              }
              const oracle = evaluateOracle(variantId, currentMeasurement.clip!);
              if (!oracle.ok) {
                manifest.skipped.push({
                  family,
                  viewport: width,
                  variant: variantId,
                  reason: oracle.reason ?? 'controlled-oracle-failed',
                });
                continue;
              }
              const before = await save(output, `${id}-before.png`, beforeBytes);
              const current = await save(output, `${id}-current.png`, currentBytes);
              const privacy = (hash: string, masks: Box[]) => ({
                version: 1,
                screenshotSha256: hash,
                mode: 'input-masked',
                masks,
                rawTraceRetained: false,
              });
              const beforePrivacy = await save(
                output,
                `${id}-before.png.privacy.json`,
                privacy(before.sha256, beforeMasks),
              );
              const currentPrivacy = await save(
                output,
                `${id}-current.png.privacy.json`,
                privacy(current.sha256, currentMasks),
              );
              const sceneValue: Scene = {
                version: 1,
                beforeSha256: before.sha256,
                currentSha256: current.sha256,
                sanitized: true,
                stable: true,
                regions: [
                  {
                    id: 'viewport',
                    box: { x: 0, y: 0, width, height },
                    before: beforeMeasurement,
                    current: currentMeasurement,
                    eligible: [true, false, false, false, false, false],
                    criterion: 'required-submit-inside-viewport',
                  },
                ],
                hardChecks: [
                  {
                    id: 'viewport-clip',
                    head: 'clipping',
                    verdict: oracle.verdict,
                    region: 'viewport',
                  },
                ],
              };
              const scene = await save(output, `${id}-scene.json`, sceneValue);
              const timeline = await save(output, `${id}-timeline.json`, {
                version: 1,
                actions: [
                  'capture-before',
                  ...(VARIANT_REGISTRY[variantId]!.label ? ['apply-controlled-regression'] : []),
                  'capture-current',
                  'measure',
                  'assert-pass',
                ],
              });
              const timelineProvenance = await save(output, `${id}-timeline.sanitization.json`, {
                version: 1,
                sha256: timeline.sha256,
                method: 'allowlisted-actions-v1',
                rawTraceRetained: false,
              });
              const caseManifest: VisualCase = {
                version: 1,
                id,
                group: family,
                revision,
                consent: true,
                context: {
                  width,
                  height,
                  dpr: 1,
                  profile: 'chromium-anonymous-light',
                  state: `required-submit-${variantId}`,
                },
                before,
                current,
                beforePrivacy,
                currentPrivacy,
                scene,
                timeline,
                timelineProvenance,
              };
              await save(output, `${id}.json`, caseManifest);
              manifest.cases.push({
                manifest: `${id}.json`,
                family,
                split,
                variant: variantId,
                viewport: width,
                label: VARIANT_REGISTRY[variantId]!.label,
                labelOrigin: VARIANT_REGISTRY[variantId]!.labelOrigin,
                measuredClip: currentMeasurement.clip!,
              });
            } finally {
              await context.close();
            }
          }
      } finally {
        await started.stop();
      }
    }
  } finally {
    await browser.close();
  }
  await save(output, 'corpus-v2.json', manifest);
  return manifest;
}

export async function trainCorpusV2(root: string, output: string, manifest: CorpusV2Manifest) {
  const rows: TrainingRow[] = [];
  const evidence = [];
  for (const entry of manifest.cases) {
    const extracted = await extractCase(output, entry.manifest);
    for (const region of extracted.regions) {
      const oracle = extracted.hardChecks.find(
        (h) => h.region === region.id && h.head === 'clipping',
      );
      if (
        region.criterion !== 'required-submit-inside-viewport' ||
        !oracle ||
        oracle.verdict !== (entry.label ? 'fail' : 'pass')
      )
        throw new Error('label-evidence-conflict');
      rows.push({
        id: `${extracted.caseId}-${region.id}`,
        group: extracted.group,
        split: entry.split,
        features: region.values,
        labels: [entry.label, null, null, null, null, null],
      });
      evidence.push({
        id: `${extracted.caseId}-${region.id}`,
        manifest: entry.manifest,
        manifestSha256: extracted.manifestSha256,
        family: entry.family,
        variant: entry.variant,
        viewport: entry.viewport,
        measuredClip: entry.measuredClip,
        labelOrigin: entry.labelOrigin,
        criterion: region.criterion,
        hardChecks: extracted.hardChecks,
      });
    }
  }
  const dataset = await save(output, 'dataset.json', rows);
  await save(output, 'dataset-provenance.json', {
    version: 1,
    datasetSha256: dataset.sha256,
    corpusManifest: 'corpus-v2.json',
    frozenAllocationHash: manifest.plan.frozenAllocationHash,
    evidence,
  });
  const { training, parityMaximumError, reviews } = await runTraining(
    root,
    output,
    rows,
    manifest.cases,
    dataset.sha256,
  );
  const report = {
    version: 1,
    rows: rows.length,
    families: manifest.plan.families,
    allocation: manifest.plan.allocation,
    frozenAllocationHash: manifest.plan.frozenAllocationHash,
    skipped: manifest.skipped,
    parityMaximumError,
    reviews,
    training,
    promotion: 'blocked-experimental-model',
    coverage: 'one-viewport-clipping-criterion; other-heads-unsupported',
    noTeacherCalls: true,
  };
  await save(output, 'corpus-report.json', report);
  return report;
}
