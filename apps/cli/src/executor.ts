import type { Diagnostic, PromotionReceipt, TruthState } from '@arxic/contracts';
import type { RunState } from '@arxic/orchestrator-langgraph';
import type { ArxicConfig } from '@arxic/worker';

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

export type CliRunOutcome = Readonly<{
  exitCode: number;
  runDirectory?: string;
  status?: string;
  outcome?: string;
  diagnostics: readonly Diagnostic[];
}>;
