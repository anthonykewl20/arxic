import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { extractCase } from './features';
import { reviewCase } from './model';

const [command, directory, ...args] = process.argv.slice(2);
if (!directory)
  throw new Error('Usage: cli.ts demo|capture|extract|review|train DIRECTORY [arguments]');
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
} else throw new Error('invalid-command');
