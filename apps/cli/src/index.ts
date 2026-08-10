export const PACKAGE_NAME = '@arxic/cli' as const;

export { runCli } from './cli';
export { WorkerRunExecutor } from './worker-executor';
export type { CliRunOutcome, DiagnosticSink, RunExecutor, RunRequest, RunResult } from './executor';
