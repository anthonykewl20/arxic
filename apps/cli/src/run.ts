import { randomUUID } from 'node:crypto';
import { chmod, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { sha256, validateDiagnostic, type Diagnostic } from '@arxic/contracts';
import type { RunState } from '@arxic/orchestrator-langgraph';
import { loadConfig } from './config/parse';
import { ARXIC_CLI_INTERNAL, ARXIC_EXEC_CRASH, cliDiagnostic } from './diagnostics';
import type { CliRunOutcome, DiagnosticSink, RunExecutor, RunResult } from './executor';
import { writeRunDirectory } from './run-directory';

export type RunActionOptions = Readonly<{
  configPath: string;
  out?: string;
  runId?: string;
  executor: RunExecutor;
  sink?: DiagnosticSink;
  cwd?: string;
  rulepacksDir?: string;
  now?: () => string;
}>;

// Exit 0 means a verified run directory was written.
// Exit 1 means a non-verified/failed run was written or output could not be written.
// Exit 2 means configuration or usage was rejected before a run directory existed.
export async function runAction(options: RunActionOptions): Promise<CliRunOutcome> {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? (() => new Date().toISOString());
  const loaded = await loadConfig(resolve(cwd, options.configPath));
  if (!loaded.ok) {
    loaded.diagnostics.forEach((diagnostic) => options.sink?.emit(diagnostic));
    return { exitCode: 2, diagnostics: loaded.diagnostics };
  }

  const repositoryDirectory = resolve(cwd, loaded.value.source.repository);
  const runId = options.runId ?? randomUUID();
  const runDirectory =
    options.out === undefined
      ? await defaultRunRoot(repositoryDirectory)
      : resolve(cwd, options.out);
  const rulepacksDir = resolve(options.rulepacksDir ?? resolve(cwd, 'rulepacks'));
  const diagnostics: Diagnostic[] = [];
  const recordingSink: DiagnosticSink = {
    emit(diagnostic) {
      if (!validateDiagnostic(diagnostic).ok)
        throw new Error('Executor emitted an invalid Diagnostic');
      diagnostics.push(diagnostic);
      options.sink?.emit(diagnostic);
    },
  };
  const startedAt = now();
  let result: RunResult;
  try {
    result = await options.executor.execute(
      {
        runId,
        config: {
          ...loaded.value,
          source: { ...loaded.value.source, repository: repositoryDirectory },
        },
        runDirectory,
        rulepacksDir,
        now,
      },
      recordingSink,
    );
    const emittedKeys = new Set(diagnostics.map(diagnosticKey));
    for (const diagnostic of result.diagnostics) {
      const key = diagnosticKey(diagnostic);
      if (!emittedKeys.has(key)) {
        recordingSink.emit(diagnostic);
        emittedKeys.add(key);
      }
    }
    result = { ...result, diagnostics };
  } catch {
    const crash = cliDiagnostic(
      ARXIC_EXEC_CRASH,
      'blocked',
      runId,
      'Executor stopped unexpectedly; a partial run record was preserved',
    );
    recordingSink.emit(crash);
    const state: RunState = {
      runId,
      status: 'failed',
      outcome: 'blocked',
      completedStages: [],
      artifacts: {},
      checkpoints: [],
      diagnostics,
      promotionEligible: false,
    };
    result = {
      runId,
      status: 'failed',
      outcome: 'blocked',
      diagnostics,
      runDirectory,
      state,
    };
  }

  const finishedAt = now();
  try {
    await writeRunDirectory(runDirectory, {
      runId,
      config: loaded.value,
      result,
      startedAt,
      finishedAt,
      now,
    });
    return {
      exitCode: result.outcome === 'verified' ? 0 : 1,
      runDirectory: resolve(runDirectory, runId),
      status: result.status,
      outcome: result.outcome,
      diagnostics,
    };
  } catch {
    const internal = cliDiagnostic(
      ARXIC_CLI_INTERNAL,
      'blocked',
      runId,
      'The run directory could not be written',
    );
    recordingSink.emit(internal);
    return { exitCode: 1, diagnostics };
  }
}

async function defaultRunRoot(repositoryDirectory: string): Promise<string> {
  const base = process.env.ARXIC_STATE_DIR ?? join(homedir(), '.arxic');
  // A moved repository gets a new state root because its resolved path changes.
  const repositoryKey = sha256(repositoryDirectory).slice(0, 16);
  const root = join(base, 'runs', repositoryKey);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700).catch(() => undefined);
  return root;
}

function diagnosticKey(diagnostic: Diagnostic): string {
  return JSON.stringify(diagnostic);
}
