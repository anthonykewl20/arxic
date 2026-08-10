import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  FileStageCheckpointer,
  LangGraphOrchestrator,
  WorkerRestartError,
  type OrchestratorInput,
  type RunState,
} from '@arxic/orchestrator-langgraph';
import { ARXIC_EXEC_RESUMED, cliDiagnostic } from './diagnostics';
import {
  runResultFromState,
  type DiagnosticSink,
  type RunExecutor,
  type RunRequest,
  type RunResult,
} from './executor';

export class LocalRunExecutor implements RunExecutor {
  async execute(request: RunRequest, sink: DiagnosticSink): Promise<RunResult> {
    const orchestrator = new LangGraphOrchestrator({
      checkpointer: new FileStageCheckpointer(request.runDirectory),
      ...(request.now === undefined ? {} : { now: request.now }),
    });
    const input = toOrchestratorInput(request);
    const emitted = [];
    let state: RunState;
    try {
      state = await orchestrator.run(input);
    } catch (error) {
      if (!(error instanceof WorkerRestartError)) throw error;
      const resumed = cliDiagnostic(
        ARXIC_EXEC_RESUMED,
        'observed',
        request.runId,
        'Worker restarted; resumed once from the last stage checkpoint',
      );
      sink.emit(resumed);
      emitted.push(resumed);
      state = await orchestrator.run(input);
    }
    state.diagnostics.forEach((diagnostic) => sink.emit(diagnostic));
    const diagnostics = [...emitted, ...state.diagnostics];
    return runResultFromState(request, state, diagnostics);
  }
}

export function toOrchestratorInput(request: RunRequest): OrchestratorInput {
  const repository = resolve(request.config.source.repository);
  const commit = resolveCommit(repository, request.config.source.revision);
  return {
    runId: request.runId,
    origin: request.config.target.origin,
    revision: {
      repository: pathToFileURL(repository).href,
      commit,
      dirty: false,
    },
    rulepacksDir: request.rulepacksDir,
    artifactsDir: request.runDirectory,
    framework: request.config.scope.frameworks[0],
    features: request.config.scope.domains,
    languages: request.config.source.languages,
    personas: request.config.scope.personas,
    maxUrls: request.config.policy.maxUrls,
    maxDepth: request.config.policy.maxDepth,
  };
}

function resolveCommit(repository: string, revision: string): string {
  if (/^[0-9a-f]{40}$/u.test(revision)) return revision;
  try {
    return execFileSync(
      'git',
      ['-C', repository, 'rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    return revision;
  }
}
