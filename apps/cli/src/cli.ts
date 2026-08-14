import { basename, resolve } from 'node:path';
import type { RunExecutor } from './executor';
import { ARXIC_VERSION } from '@arxic/contracts';
import type { WorkerClient } from '@arxic/worker';
import { parseArgs } from './args';

export type OutputSink = { write(message: string): unknown } | { log(message: string): unknown };

export type RunCliOptions = Readonly<{
  executor?: RunExecutor;
  workerClient?: WorkerClient;
  stdout?: OutputSink;
  stderr?: OutputSink;
  cwd?: string;
  rulepacksDir?: string;
  now?: () => string;
}>;

export async function runCli(
  argv: readonly string[],
  options: RunCliOptions = {},
): Promise<{ exitCode: number; runDirectory?: string }> {
  const stdout = options.stdout ?? console;
  const stderr = options.stderr ?? console;
  try {
    const parsed = parseArgs(argv);
    if (!parsed.ok) {
      parsed.diagnostics.forEach((diagnostic) => print(stderr, formatDiagnostic(diagnostic)));
      return { exitCode: 2 };
    }
    if (parsed.command.kind === 'version') {
      print(stdout, ARXIC_VERSION);
      return { exitCode: 0 };
    }
    if (parsed.command.kind === 'help') {
      print(stdout, parsed.command.command === 'run' ? RUN_HELP : HELP);
      return { exitCode: 0 };
    }
    const { runAction } = await import('./run');
    const outcome = await runAction({
      configPath: parsed.command.config,
      ...(parsed.command.out === undefined ? {} : { out: parsed.command.out }),
      ...(parsed.command.runId === undefined ? {} : { runId: parsed.command.runId }),
      executor:
        options.executor ??
        (await defaultExecutor(parsed.command.executor ?? 'local', options.workerClient)),
      cwd: options.cwd ?? process.cwd(),
      ...(options.rulepacksDir === undefined ? {} : { rulepacksDir: options.rulepacksDir }),
      ...(options.now === undefined ? {} : { now: options.now }),
      sink: { emit: (diagnostic) => print(stderr, formatDiagnostic(diagnostic)) },
    });
    if (
      outcome.runDirectory !== undefined &&
      outcome.status !== undefined &&
      outcome.outcome !== undefined
    ) {
      const runDirectory = resolve(outcome.runDirectory);
      print(
        stdout,
        `arxic run ${basename(runDirectory)} -> ${runDirectory} (status=${outcome.status}, outcome=${outcome.outcome})`,
      );
    }
    return {
      exitCode: outcome.exitCode,
      ...(outcome.runDirectory === undefined
        ? {}
        : { runDirectory: resolve(outcome.runDirectory) }),
    };
  } catch {
    const { ARXIC_CLI_INTERNAL, cliDiagnostic } = await import('./diagnostics');
    const diagnostic = cliDiagnostic(
      ARXIC_CLI_INTERNAL,
      'blocked',
      'cli',
      'The CLI stopped because of an unexpected internal error',
    );
    print(stderr, formatDiagnostic(diagnostic));
    return { exitCode: 1 };
  }
}

async function defaultExecutor(
  executor: 'local' | 'worker',
  workerClient: WorkerClient | undefined,
): Promise<RunExecutor> {
  if (executor === 'local') {
    const { LocalRunExecutor } = await import('./local-executor');
    return new LocalRunExecutor();
  }
  const [{ createLocalWorkerClient }, { WorkerRunExecutor }] = await Promise.all([
    import('@arxic/worker'),
    import('./worker-executor'),
  ]);
  return new WorkerRunExecutor(workerClient ?? createLocalWorkerClient());
}

const HELP = `Usage: arxic <command> [options]\n\nCommands:\n  run --config <path>  Start a run (local by default)\n\nOptions:\n  -h, --help            Show help\n  -v, --version         Show version`;
const RUN_HELP = `Usage: arxic run --config <path> [--executor <local|worker>] [--out <dir>] [--run-id <id>]`;

function formatDiagnostic(diagnostic: { code: string; subject: string; message: string }): string {
  return `${diagnostic.code} [${diagnostic.subject}] ${diagnostic.message}`;
}

function print(sink: OutputSink, message: string): void {
  if ('write' in sink) sink.write(`${message}\n`);
  else sink.log(message);
}
