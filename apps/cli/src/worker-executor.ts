import { validateDiagnostic, type Diagnostic } from '@arxic/contracts';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { promoteWorkerCandidate, type RunState } from '@arxic/orchestrator-langgraph';
import type { ImportedArtifacts, RunHandle, WorkerClient } from '@arxic/worker';
import {
  ARXIC_EXEC_WORKER_APPROVAL_REQUIRED,
  ARXIC_EXEC_WORKER_INTERRUPTED,
  ARXIC_EXEC_WORKER_PROTOCOL,
  cliDiagnostic,
} from './diagnostics';
import {
  normalizeWorkerResult,
  runResultFromState,
  type DiagnosticSink,
  type RunExecutor,
  type RunRequest,
  type RunResult,
} from './executor';

/**
 * CLI action adapter for the WorkerClient lifecycle. Pipeline mechanics stay
 * in the isolated runtime; this action owns failure classification, trusted
 * CLI-side promotion, and the final local/worker normalization decision.
 */
export class WorkerRunExecutor implements RunExecutor {
  constructor(private readonly client: WorkerClient) {}

  async execute(request: RunRequest, sink: DiagnosticSink): Promise<RunResult> {
    const diagnostics: Diagnostic[] = [];
    const record = (diagnostic: Diagnostic): void => {
      if (
        !diagnostics.some((existing) => JSON.stringify(existing) === JSON.stringify(diagnostic))
      ) {
        diagnostics.push(diagnostic);
        sink.emit(diagnostic);
      }
    };
    const emitWorker = (diagnostic: Diagnostic): void =>
      record(safeWorkerDiagnostic(diagnostic, request.runId));

    let handle: RunHandle;
    try {
      handle = await this.client.start({
        runId: request.runId,
        config: request.config,
      });
    } catch {
      record(interrupted(request.runId));
      return failedResult(request, diagnostics);
    }
    handle.diagnostics.forEach(emitWorker);
    if (handle.status === 'failed') {
      if (diagnostics.length === 0) record(interrupted(request.runId));
      return failedResult(request, diagnostics);
    }

    let finished: RunHandle | undefined;
    let imported: ImportedArtifacts | undefined;
    try {
      for await (const event of this.client.stream(handle)) {
        if (event.type === 'diagnostic') emitWorker(event.diagnostic);
        if (event.type === 'awaiting-approval') {
          record(
            cliDiagnostic(
              ARXIC_EXEC_WORKER_APPROVAL_REQUIRED,
              'blocked',
              request.runId,
              'Worker execution requires an explicit approval workflow that this CLI invocation did not provide',
            ),
          );
          await this.cancelAndCollect(handle, emitWorker);
          return failedResult(request, diagnostics);
        }
        if (event.type === 'result-ready') {
          try {
            imported = await this.client.collectArtifacts(handle);
            if (JSON.stringify(imported.manifest) !== JSON.stringify(event.manifest)) {
              throw new Error('Artifact manifest changed after result-ready');
            }
          } catch {
            record(
              safeWorkerDiagnostic(
                {
                  code: 'ARXIC-WORKER-RUN-FAILED',
                  severity: 'blocked',
                  subject: request.runId,
                  message: 'Worker artifact ingress failed',
                },
                request.runId,
              ),
            );
          }
        }
        if (event.type === 'finished') finished = event.handle;
      }
      if (finished !== undefined) finished = await this.client.inspect(finished);
    } catch {
      record(interrupted(request.runId));
      await this.cancelAndCollect(handle, emitWorker);
      return failedResult(request, diagnostics);
    }

    if (finished === undefined) {
      record(interrupted(request.runId));
      await this.cancelAndCollect(handle, emitWorker);
      return failedResult(request, diagnostics);
    }
    finished.diagnostics.forEach(emitWorker);
    if (
      imported === undefined &&
      !diagnostics.some(({ code }) => code === 'ARXIC-WORKER-RUN-FAILED')
    ) {
      record(
        safeWorkerDiagnostic(
          {
            code: 'ARXIC-WORKER-RUN-FAILED',
            severity: 'blocked',
            subject: request.runId,
            message: 'Worker artifact result was missing',
          },
          request.runId,
        ),
      );
    }
    if (imported === undefined) return failedResult(request, diagnostics);
    const normalized = normalizeWorkerResult(request, imported);
    if (!normalized.ok) {
      record(
        normalized.kind === 'verifier'
          ? safeWorkerDiagnostic(
              {
                code: 'ARXIC-WORKER-RUN-FAILED',
                severity: 'blocked',
                subject: request.runId,
                message: normalized.reason,
              },
              request.runId,
            )
          : protocolFailure(request.runId),
      );
      return failedResult(request, diagnostics);
    }
    try {
      await writeImportedArtifacts(request.runDirectory, request.runId, imported);
    } catch {
      record(
        safeWorkerDiagnostic(
          {
            code: 'ARXIC-WORKER-RUN-FAILED',
            severity: 'blocked',
            subject: request.runId,
            message: 'Worker artifact ingress failed',
          },
          request.runId,
        ),
      );
      return failedResult(request, diagnostics);
    }

    let state = {
      ...normalized.state,
      diagnostics: [...diagnostics, ...normalized.state.diagnostics],
    };
    if (state.outcome === 'verified') {
      if (!normalized.stagedBundle) {
        record(protocolFailure(request.runId));
        return failedResult(request, diagnostics);
      }
      try {
        const receipt = await promoteWorkerCandidate({
          bundle: normalized.stagedBundle,
          gates: normalized.gateResults,
          publicPath: resolve(request.runDirectory, 'promoted', `${request.runId}.bundle.json`),
          ...(request.now ? { now: request.now } : {}),
        });
        state = {
          ...state,
          status: 'completed' as const,
          promotionEligible: true,
          receipt,
        };
      } catch {
        record(
          safeWorkerDiagnostic(
            {
              code: 'ARXIC-WORKER-RUN-FAILED',
              severity: 'blocked',
              subject: request.runId,
              message: 'CLI-side candidate promotion failed',
            },
            request.runId,
          ),
        );
        return failedResult(request, diagnostics);
      }
    }
    state.diagnostics.forEach(emitWorker);
    return runResultFromState(request, state, diagnostics);
  }

  private async cancelAndCollect(
    handle: RunHandle,
    emit: (diagnostic: Diagnostic) => void,
  ): Promise<void> {
    try {
      const canceled = await this.client.cancel(handle);
      canceled.diagnostics.forEach(emit);
    } catch {
      // The interruption diagnostic already records the fail-closed outcome;
      // cancellation errors must not expose provider or worker prose.
    }
  }
}

async function writeImportedArtifacts(
  runDirectory: string,
  runId: string,
  imported: ImportedArtifacts,
): Promise<void> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) throw new Error('Unsafe run id');
  const root = resolve(runDirectory, runId, 'artifacts');
  const staging = resolve(runDirectory, runId, 'artifacts.importing');
  await mkdir(resolve(runDirectory, runId), { recursive: true, mode: 0o700 });
  await mkdir(staging, { recursive: false, mode: 0o700 });
  try {
    for (const artifact of imported.files) {
      const target = resolve(staging, ...artifact.path.split('/'));
      if (!target.startsWith(`${staging}${sep}`)) throw new Error('Unsafe artifact path');
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, artifact.bytes, { mode: 0o600, flag: 'wx' });
    }
    await rename(staging, root);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

function safeWorkerDiagnostic(diagnostic: Diagnostic, runId: string): Diagnostic {
  if (!validateDiagnostic(diagnostic).ok) return interrupted(runId);
  const message = safeWorkerMessage(diagnostic.code);
  if (message === undefined) return interrupted(runId);
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    subject: runId,
    message,
  };
}

function safeWorkerMessage(code: string): string | undefined {
  const messages: Readonly<Record<string, string>> = {
    'ARXIC-WORKER-CLEANUP-FAILED': 'Worker cleanup did not complete',
    'ARXIC-WORKER-CONFIG-UNSAFE': 'Worker configuration was rejected by isolation policy',
    'ARXIC-WORKER-INJECTION-NEUTRALIZED': 'Injection-shaped source content was treated as data',
    'ARXIC-WORKER-ISOLATION-VIOLATED': 'The isolated worker could not be started safely',
    'ARXIC-WORKER-QUOTA-EXCEEDED': 'Worker execution exceeded an enforced quota',
    'ARXIC-WORKER-RUN-FAILED': 'Worker execution failed',
    'ARXIC-WORKER-TIMEOUT': 'Worker execution exceeded its wall-clock quota',
  };
  return messages[code];
}

function protocolFailure(runId: string): Diagnostic {
  return cliDiagnostic(
    ARXIC_EXEC_WORKER_PROTOCOL,
    'blocked',
    runId,
    'Worker pipeline result protocol is unavailable; lifecycle completion is not pipeline completion',
  );
}

function interrupted(runId: string): Diagnostic {
  return cliDiagnostic(
    ARXIC_EXEC_WORKER_INTERRUPTED,
    'blocked',
    runId,
    'Worker startup or event streaming was interrupted; execution was canceled fail-closed',
  );
}

function failedResult(request: RunRequest, diagnostics: readonly Diagnostic[]): RunResult {
  const state: RunState = {
    runId: request.runId,
    status: 'failed',
    outcome: 'blocked',
    completedStages: [],
    artifacts: {},
    checkpoints: [],
    diagnostics,
    promotionEligible: false,
  };
  return {
    runId: request.runId,
    status: 'failed',
    outcome: 'blocked',
    diagnostics,
    runDirectory: request.runDirectory,
    state,
  };
}
