import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig } from '../../cli/src/config/parse';
import { LocalRunExecutor } from '../../cli/src/local-executor';
import { runAction } from '../../cli/src/run';
import { validateIntentLedger } from '../../../packages/intent/src/ledger';
import { inside } from './projects';
import type { Run, RunResult } from './types';

export async function runAgent(run: Run, directory: string): Promise<RunResult> {
  if (!run.project.configPath)
    return {
      outcome: 'blocked',
      summary: 'Choose an Arxic configuration file in the project settings before running AI E2E.',
    };
  const configPath = await realpath(run.project.configPath);
  if (!inside(run.project.folder, configPath))
    return {
      outcome: 'blocked',
      summary: 'The configuration file no longer belongs to the project folder.',
    };
  const loaded = await loadConfig(configPath);
  if (!loaded.ok)
    return {
      outcome: 'blocked',
      summary: 'The Arxic configuration is invalid. Validate it with the CLI configuration guide.',
    };
  const source = await realpath(resolve(run.project.folder, loaded.value.source.repository));
  if (source !== run.project.folder || loaded.value.target.origin !== run.project.origin)
    return {
      outcome: 'blocked',
      summary:
        'Configuration source and target must match the dashboard project folder and origin.',
    };
  const snapshot = join(directory, 'engine-config.json');
  await writeFile(
    snapshot,
    JSON.stringify({ ...loaded.value, source: { ...loaded.value.source, repository: source } }),
    { mode: 0o600 },
  );
  const outcome = await runAction({
    configPath: snapshot,
    out: join(directory, 'engine'),
    runId: run.id,
    executor: new LocalRunExecutor(),
    cwd: run.project.folder,
    rulepacksDir: resolve(import.meta.dirname, '../../../rulepacks'),
  });
  let engineRun: unknown;
  let ledger: unknown;
  if (outcome.runDirectory) {
    engineRun = JSON.parse(await readFile(join(outcome.runDirectory, 'run.json'), 'utf8'));
    try {
      const candidate = validateIntentLedger(
        JSON.parse(await readFile(join(outcome.runDirectory, 'intents.json'), 'utf8')),
      );
      if (candidate.ok) ledger = candidate.value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const truth = outcome.outcome;
  return {
    outcome:
      truth === 'verified' ||
      truth === 'observed' ||
      truth === 'hypothesized' ||
      truth === 'contradicted'
        ? truth
        : 'blocked',
    summary:
      outcome.exitCode === 0
        ? 'The existing deterministic verifier passed this candidate. Inspect the intent ledger for remaining coverage gaps.'
        : 'The AI pipeline did not produce a verified candidate. Review its diagnostics and unmet prerequisites.',
    diagnostics: outcome.diagnostics,
    engineRun,
    ledger,
  };
}
