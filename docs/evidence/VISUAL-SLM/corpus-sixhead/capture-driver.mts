// Temporary local S3 driver: capture the 10-family six-head corpus and train.
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  captureCorpusV2,
  trainCorpusV2,
} from '/home/soultransit/devtony/arxic/.worktrees/visual-slm-423-pilot/apps/web/src/compact-visual/corpus-capture';

const root = resolve('/home/soultransit/devtony/arxic/.worktrees/visual-slm-423-pilot');
const output = process.argv[2] ?? '/tmp/arxic-423-corpus-sixhead';
await rm(output, { recursive: true, force: true });
const families = [
  'next',
  'express',
  'arxic',
  'koel',
  'directus',

  'todomvc',
  'gentelella',
  'sb-admin',
  'adminlte',
];
const variants = [
  'clean',
  'clip-full',
  'clip-right-75',
  'clip-right-50',
  'clip-right-25',
  'clip-bottom-50',
  'overflow-x',
  'content-change',
  'overlay-adjacent',
  'style-tweak',
  'occlusion-overlay',
  'missing-element',
  'text-truncate',
  'layout-shift',
];
console.log('capturing', families.length, 'families x', variants.length, 'variants...');
const manifest = await captureCorpusV2(root, output, families, [800, 1280], variants);
console.log('cases:', manifest.cases.length, 'skipped:', JSON.stringify(manifest.skipped));
console.log('allocation:', JSON.stringify(manifest.plan.allocation));
const report = await trainCorpusV2(root, output, manifest);
console.log('rows:', report.rows);
console.log('supported:', JSON.stringify(report.training.models.mlp.training.supported));
console.log(
  'thresholds:',
  JSON.stringify(report.training.models.mlp.positiveThresholds),
);
console.log('parityMaxError:', report.parityMaximumError);
console.log('reviews all-fail:', report.reviews.every((r) => r.overallPass === false));
await mkdir(join(output, 'summary'), { recursive: true });
await writeFile(
  join(output, 'summary', 'capture-console.txt'),
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      cases: manifest.cases.length,
      skipped: manifest.skipped,
      allocation: manifest.plan.allocation,
      rows: report.rows,
      supported: report.training.models.mlp.training.supported,
      thresholds: report.training.models.mlp.positiveThresholds,
      parityMaximumError: report.parityMaximumError,
    },
    null,
    1,
  ),
);
console.log('S3 CAPTURE+TRAIN COMPLETE →', output);
