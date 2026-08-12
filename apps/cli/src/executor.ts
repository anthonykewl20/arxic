import type { Diagnostic, PromotionReceipt, TruthState } from '@arxic/contracts';
import type { RunState } from '@arxic/orchestrator-langgraph';
import type { ArxicConfig } from '@arxic/worker';

export { normalizeWorkerResult } from './worker-result-normalize';

export interface DiagnosticSink {
  emit(diagnostic: Diagnostic): void;
}

export type RunRequest = Readonly<{
  runId: string;
  config: ArxicConfig;
  runDirectory: string;
  rulepacksDir: string;
  now?: () => string;
}>;

export type RunResult = Readonly<{
  runId: string;
  status: 'completed' | 'partial' | 'failed';
  outcome: TruthState;
  diagnostics: readonly Diagnostic[];
  runDirectory: string;
  state: RunState;
  receipt?: PromotionReceipt;
}>;

export interface RunExecutor {
  execute(request: RunRequest, sink: DiagnosticSink): Promise<RunResult>;
}

/** One normalization path for in-process and worker-produced RunState. */
export function runResultFromState(
  request: RunRequest,
  state: RunState,
  diagnostics: readonly Diagnostic[] = state.diagnostics,
): RunResult {
  return {
    runId: state.runId,
    status: finalStatus(state),
    outcome: state.outcome,
    diagnostics,
    runDirectory: request.runDirectory,
    state,
    ...(state.receipt === undefined ? {} : { receipt: state.receipt }),
  };
}

function finalStatus(state: RunState): RunResult['status'] {
  if (state.status === 'completed' || state.status === 'partial' || state.status === 'failed') {
    return state.status;
  }
  return 'partial';
}

export type CliRunOutcome = Readonly<{
  exitCode: number;
  runDirectory?: string;
  status?: string;
  outcome?: string;
  diagnostics: readonly Diagnostic[];
}>;
