import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, type Page, type Locator } from 'playwright';
import { sha256 } from '@arxic/contracts';
import { captureMaskedViewport } from '@arxic/playwright-screenshot-privacy';
import {
  bootFixtureApp,
  referenceAuthApp,
  vulnerableAuthApp,
  stopApp,
} from '../../../../packages/real-world-testkit/src';
import { startWorkbench } from '../server';
import { extractCase } from './features';
import { runTraining } from './train-runner';
import type { Box, Measurement, Scene, VisualCase } from './evidence';

const execute = promisify(execFile);
type Entry = { manifest: string; split: 'train' | 'calibration' | 'test'; label: 0 | 1 };
export type Corpus = { version: 1; cases: Entry[]; provenance: string };
export async function save(root: string, path: string, value: unknown) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + '\n');
  await writeFile(join(root, path), bytes, { mode: 0o600, flag: 'wx' });
  return { path, sha256: sha256(bytes) };
}

export async function measure(
  button: Locator,
  width: number,
  height: number,
): Promise<Measurement> {
  const box = await button.boundingBox();
  if (!box || !box.width || !box.height) throw new Error('missing-control');
  // This smoke criterion names the viewport clip, not arbitrary ancestor paint.
  const area =
    Math.max(0, Math.min(box.x + box.width, width) - Math.max(box.x, 0)) *
    Math.max(0, Math.min(box.y + box.height, height) - Math.max(box.y, 0));
  return {
    box,
    clip: area / (box.width * box.height),
    hit: null,
    overflowX: null,
    overflowY: null,
  };
}
export async function maskBoxes(page: Page): Promise<Box[]> {
  return page.locator('input, textarea, [contenteditable="true"]').evaluateAll((nodes) =>
    nodes
      .map((n) => {
        const b = n.getBoundingClientRect();
        return {
          x: Math.max(0, b.x),
          y: Math.max(0, b.y),
          width: Math.max(0, Math.min(innerWidth, b.right) - Math.max(0, b.x)),
          height: Math.max(0, Math.min(innerHeight, b.bottom) - Math.max(0, b.y)),
        };
      })
      .filter((b) => b.width && b.height),
  );
}

export async function captureCorpus(
  root: string,
  output: string,
  widths = [640, 800, 1024, 1280],
): Promise<Corpus> {
  await mkdir(output, { recursive: true, mode: 0o700 });
  const revision = (await execute('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const browser = await chromium.launch({ headless: true });
  const corpus: Corpus = {
    version: 1,
    cases: [],
    provenance:
      'Controlled viewport-clipping regressions on actual Next, Express and Arxic; three independent application groups; smoke corpus only.',
  };
  try {
    for (const [index, group] of ['next', 'express', 'arxic'].entries()) {
      const state = await mkdtemp(join(tmpdir(), 'visual-capture-'));
      const app =
        group === 'arxic'
          ? await startWorkbench({
              roots: [root],
              stateDirectory: state,
              adminToken: 'visual-capture-anonymous-only-token',
              port: 0,
            })
          : null;
      const fixture =
        group !== 'arxic'
          ? await bootFixtureApp(
              root,
              index === 0 ? referenceAuthApp : vulnerableAuthApp,
              'visual-capture',
            )
          : null;
      try {
        for (const width of widths)
          for (const label of [0, 1] as const) {
            const height = 800,
              id = `${group}-${width}-${label ? 'clipped' : 'clean'}`;
            const context = await browser.newContext({
              viewport: { width, height },
              deviceScaleFactor: 1,
              reducedMotion: 'reduce',
              colorScheme: 'light',
              serviceWorkers: 'block',
            });
            const page = await context.newPage();
            try {
              await page.goto(
                (app?.origin ?? fixture!.origin) + (group === 'next' ? '/login' : '/'),
              );
              const button =
                group === 'arxic'
                  ? page.getByRole('button', { name: 'Open workbench' })
                  : page.getByRole('button', { name: 'Login', exact: true });
              await button.waitFor({ state: 'visible' });
              await page.evaluate(() => document.fonts.ready);
              const beforeMeasurement = await measure(button, width, height);
              if (beforeMeasurement.clip !== 1) throw new Error('baseline-not-inside-viewport');
              const beforeMasks = await maskBoxes(page);
              const beforeBytes = await captureMaskedViewport(page, {
                automaticMasks: ['input', 'textarea', '[contenteditable="true"]'],
                requiredMasks: [],
              });
              if (label)
                await button.evaluate((node) => {
                  (node as HTMLElement).style.transform = 'translateX(3000px)';
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
              )
                throw new Error('unstable-case');
              if ((currentMeasurement.clip === 0) !== Boolean(label))
                throw new Error('controlled-oracle-failed');
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
                    verdict: currentMeasurement.clip === 1 ? 'pass' : 'fail',
                    region: 'viewport',
                  },
                ],
              };
              const scene = await save(output, `${id}-scene.json`, sceneValue);
              const timeline = await save(output, `${id}-timeline.json`, {
                version: 1,
                actions: [
                  'capture-before',
                  ...(label ? ['apply-controlled-regression'] : []),
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
              const manifest: VisualCase = {
                version: 1,
                id,
                group,
                revision,
                consent: true,
                context: {
                  width,
                  height,
                  dpr: 1,
                  profile: 'chromium-anonymous-light',
                  state: 'required-submit',
                },
                before,
                current,
                beforePrivacy,
                currentPrivacy,
                scene,
                timeline,
                timelineProvenance,
              };
              await save(output, `${id}.json`, manifest);
              corpus.cases.push({
                manifest: `${id}.json`,
                split: index === 0 ? 'train' : index === 1 ? 'calibration' : 'test',
                label,
              });
            } finally {
              await context.close();
            }
          }
      } finally {
        await app?.close();
        if (fixture) {
          await stopApp(fixture.child);
          await rm(fixture.runtimeDirectory, { recursive: true, force: true });
        }
        await rm(state, { recursive: true, force: true });
      }
    }
  } finally {
    await browser.close();
  }
  await save(output, 'corpus.json', corpus);
  return corpus;
}

export async function trainCorpus(root: string, output: string, corpus: Corpus, epochs = 30) {
  if (
    corpus.version !== 1 ||
    !Array.isArray(corpus.cases) ||
    !corpus.cases.length ||
    corpus.cases.length > 128 ||
    corpus.cases.some(
      (c) => ![0, 1].includes(c.label) || !['train', 'calibration', 'test'].includes(c.split),
    )
  )
    throw new Error('invalid-corpus');
  const rows = [],
    evidence = [];
  for (const entry of corpus.cases) {
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
        criterion: region.criterion,
        labelOrigin: 'controlled-regression-independent-viewport-measurement',
        hardChecks: extracted.hardChecks,
      });
    }
  }
  const dataset = await save(output, 'dataset.json', rows);
  await save(output, 'dataset-provenance.json', {
    version: 1,
    datasetSha256: dataset.sha256,
    evidence,
  });
  const { training, parityMaximumError, reviews } = await runTraining(
    root,
    output,
    rows,
    corpus.cases,
    dataset.sha256,
    epochs,
  );
  const report = {
    version: 1,
    rows: rows.length,
    groups: [...new Set(rows.map((r) => r.group))],
    parityMaximumError,
    reviews,
    training,
    deterministicBaseline: {
      criterion: 'required-submit-inside-viewport',
      testCases: corpus.cases.filter((c) => c.split === 'test').length,
      truePositives: corpus.cases.filter((c) => c.split === 'test' && c.label === 1).length,
      falsePositives: 0,
      falseNegatives: 0,
      basis:
        'all corpus labels independently checked against retained viewport geometry before training; no baseline false alerts in this controlled corpus, so no demonstrated incremental value',
    },
    promotion: 'blocked-insufficient-independent-data',
    coverage: 'one-viewport-clipping-criterion; other-heads-unsupported',
    noTeacherCalls: true,
  };
  await save(output, 'foundation-report.json', report);
  return report;
}
