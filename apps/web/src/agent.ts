import { rulepacksDirectory } from './runtime';
import { collectWorkflowCaptures } from './workflow-captures';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadConfig } from '../../cli/src/config/parse';
import { LocalRunExecutor } from '../../cli/src/local-executor';
import { runAction } from '../../cli/src/run';
import { validateIntentLedger } from '../../../packages/intent/src/ledger';
import { inside } from './projects';
import { executionConfig } from './execution';
import type { ExecutionSettings } from './execution';
import type { Run, RunResult } from './types';

/**
 * Per-run execution settings for variant fan-out runs: flag variants merge
 * their overrides over the project flags; the anonymous state variant switches
 * persona mode with the persona secret refs cleared (the validated anonymous
 * shape — anonymous mode must not carry persona secret refs); persona variants
 * with a stamped login override swap the login surface (route + present labels
 * merge over the project values). Returns the project settings untouched for
 * default and plain persona-variant runs; the single executionConfig(...) call
 * site below stays the only config builder.
 */
function variantExecution(execution: ExecutionSettings, run: Run): ExecutionSettings {
  const flags = run.workflowScope?.variantFlags;
  const withFlags =
    flags && Object.keys(flags).length
      ? { ...execution, featureFlags: { ...execution.featureFlags, ...flags } }
      : execution;
  const login = run.workflowScope?.variantLogin;
  const withLogin =
    login && !run.workflowScope?.variantState
      ? {
          ...withFlags,
          persona: {
            ...withFlags.persona,
            loginPath: login.route,
            ...(login.emailLabel ? { emailLabel: login.emailLabel } : {}),
            ...(login.passwordLabel ? { passwordLabel: login.passwordLabel } : {}),
            ...(login.submitLabel ? { submitLabel: login.submitLabel } : {}),
          },
        }
      : withFlags;
  if (run.workflowScope?.variantState !== 'anonymous') return withLogin;
  return {
    ...withLogin,
    persona: {
      ...withLogin.persona,
      mode: 'anonymous',
      emailRef: '',
      passwordRef: '',
      newPasswordRef: '',
    },
  };
}

export async function runAgent(run: Run, directory: string): Promise<RunResult> {
  if (!run.project.configPath && !run.project.execution)
    return {
      outcome: 'blocked',
      summary:
        'Configure guided AI execution or choose an Arxic configuration file before running AI E2E.',
    };
  let loaded;
  if (run.project.execution) {
    loaded = {
      ok: true as const,
      value: executionConfig(
        variantExecution(run.project.execution, run),
        run.project.folder,
        run.project.origin,
      ),
    };
  } else {
    const configPath = await realpath(run.project.configPath);
    if (!inside(run.project.folder, configPath))
      return {
        outcome: 'blocked',
        summary: 'The configuration file no longer belongs to the project folder.',
      };
    loaded = await loadConfig(configPath);
  }
  if (!loaded.ok)
    return {
      outcome: 'blocked',
      summary: 'The Arxic configuration is invalid. Validate it with the CLI configuration guide.',
    };
  if (loaded.value.policy.checkpointCapture && !run.project.captureConsent)
    return {
      outcome: 'blocked',
      summary: 'Workflow screenshots require capture consent in project settings.',
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
    JSON.stringify({
      ...loaded.value,
      source: {
        ...loaded.value.source,
        repository: source,
        ...(run.workflowScope ? { revision: run.workflowScope.sourceCommit } : {}),
      },
      ...(run.workflowScope
        ? {
            scope: { ...loaded.value.scope, inventoryRowIds: [run.workflowScope.inventoryRowId] },
          }
        : {}),
    }),
    { mode: 0o600 },
  );
  const outcome = await runAction({
    configPath: snapshot,
    out: join(directory, 'engine'),
    runId: run.id,
    executor: new LocalRunExecutor(),
    cwd: run.project.folder,
    rulepacksDir: rulepacksDirectory,
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
  let workflowCaptures: RunResult['workflowCaptures'];
  let workflowCaptureGap: string | undefined;
  if (loaded.value.policy.checkpointCapture && truth === 'verified') {
    try {
      workflowCaptures = await collectWorkflowCaptures(directory, run.id);
    } catch {
      workflowCaptureGap =
        'Workflow checkpoints are unavailable: their evidence could not be validated. Run the workflow again to produce fresh evidence.';
    }
  }
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
    ...(workflowCaptures ? { workflowCaptures } : {}),
    ...(workflowCaptureGap ? { workflowCaptureGap } : {}),
    diagnostics: outcome.diagnostics,
    engineRun,
    ledger,
  };
}
