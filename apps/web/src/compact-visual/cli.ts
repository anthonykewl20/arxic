import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { extractCase } from './features';
import { reviewCase } from './model';

const [command, directory, ...args] = process.argv.slice(2);
if (!directory)
  throw new Error(
    'Usage: cli.ts demo|capture|extract|review|train|corpus|corpus-evaluate DIRECTORY [...] | activate DIRECTORY MODEL MODELS_DIR NATIVE [REPORT] | rollback MODELS_DIR',
  );
const root = resolve(import.meta.dirname, '../../../..');
const output = resolve(directory);
if (command === 'capture') {
  const { captureCorpus } = await import('./workflow');
  await captureCorpus(root, output);
} else if (command === 'demo') {
  const { captureCorpus, trainCorpus } = await import('./workflow');
  const corpus = await captureCorpus(root, output);
  const report = await trainCorpus(root, output, corpus);
  console.log(
    JSON.stringify({
      rows: report.rows,
      groups: report.groups,
      parityMaximumError: report.parityMaximumError,
      promotion: report.promotion,
      report: 'foundation-report.json',
    }),
  );
} else if (command === 'extract' && args[0]) {
  console.log(JSON.stringify(await extractCase(output, args[0]), null, 2));
} else if (command === 'review' && args.length === 3) {
  console.log(
    JSON.stringify(await reviewCase(output, args[0]!, args[1]!, resolve(args[2]!)), null, 2),
  );
} else if (command === 'train') {
  const { trainCorpus } = await import('./workflow');
  await trainCorpus(
    root,
    output,
    JSON.parse(await readFile(resolve(output, 'corpus.json'), 'utf8')),
  );
} else if (command === 'corpus-evaluate') {
  const { evaluateCorpusV2 } = await import('./corpus-evaluate');
  const families = args[0] ? args[0].split(',').filter(Boolean) : undefined;
  const viewports = args[1]
    ? args[1].split(',').filter(Boolean).map(Number)
    : undefined;
  const variants = args[2] ? args[2].split(',').filter(Boolean) : undefined;
  const report = await evaluateCorpusV2(root, output, { families, viewports, variants });
  console.log(
    JSON.stringify({
      rows: report.rows,
      heads: report.heads,
      models: report.models,
      report: 'corpus-evaluation.json',
    }),
  );
} else if (command === 'corpus') {
  const { captureCorpusV2, trainCorpusV2 } = await import('./corpus-capture');
  const families = (args[0] ?? 'next,express,arxic,koel,directus').split(',').filter(Boolean);
  const viewports = (args[1] ?? '360,640,1024,1280').split(',').filter(Boolean).map(Number);
  const variants = (args[2] ?? '').split(',').filter(Boolean);
  const manifest = await captureCorpusV2(
    root,
    output,
    families,
    viewports,
    variants.length ? variants : undefined,
  );
  const report = await trainCorpusV2(root, output, manifest);
  console.log(
    JSON.stringify({
      rows: report.rows,
      families: report.families,
      allocation: report.allocation,
      skipped: report.skipped.length,
      parityMaximumError: report.parityMaximumError,
      promotion: report.promotion,
      report: 'corpus-report.json',
    }),
  );
} else if (command === 'activate' && args.length >= 3) {
  const { activateTrainedModel } = await import('./model-store');
  const pointer = await activateTrainedModel(
    output,
    args[0]!,
    resolve(args[1]!),
    resolve(args[2]!),
    {
      reportPath: args[3],
    },
  );
  console.log(JSON.stringify(pointer));
} else if (command === 'rollback' && args[0]) {
  const { rollbackModel } = await import('./model-store');
  console.log(JSON.stringify(await rollbackModel(resolve(args[0]))));
} else throw new Error('invalid-command');
