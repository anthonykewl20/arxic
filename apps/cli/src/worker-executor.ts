import {
  validateDiagnostic,
  type ArtifactRef,
  type Diagnostic,
  type StagedBundle,
} from '@arxic/contracts';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { promoteWorkerCandidate, type RunState } from '@arxic/orchestrator-langgraph';
import { scanTextForSecrets } from '@arxic/bundle-promoter';
import {
  WORKER_SOURCE_PATH,
  hashSourceTree,
  type ImportedArtifacts,
  type RunHandle,
  type WorkerClient,
} from '@arxic/worker';
import {
  stageIntentLedger,
  type IntentLedger,
  type StageIntentLedgerOutcome,
} from '../../../packages/intent/src/ledger';
import {
  ARXIC_EXEC_WORKER_APPROVAL_REQUIRED,
  ARXIC_EXEC_WORKER_INTERRUPTED,
  ARXIC_EXEC_WORKER_PROTOCOL,
  ARXIC_EXEC_WORKER_SOURCE_MISMATCH,
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

type WorkerRunExecutorOptions = Readonly<{
  sourceHash?: (repository: string) => Promise<string>;
}>;

/**
 * CLI action adapter for the WorkerClient lifecycle. Pipeline mechanics stay
 * in the isolated runtime; this action owns failure classification, trusted
 * CLI-side promotion, and the final local/worker normalization decision.
 */
export class WorkerRunExecutor implements RunExecutor {
  private readonly sourceHash: (repository: string) => Promise<string>;

  constructor(
    private readonly client: WorkerClient,
    options: WorkerRunExecutorOptions = {},
  ) {
    this.sourceHash =
      options.sourceHash ?? (async (repository) => (await hashSourceTree(repository)).sourceSha256);
  }

  async execute(request: RunRequest, sink: DiagnosticSink): Promise<RunResult> {
    const workerConfig = {
      ...request.config,
      source: { ...request.config.source, repository: WORKER_SOURCE_PATH },
    };
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
    let trustedSourceSha256: string;
    try {
      trustedSourceSha256 = await this.sourceHash(request.config.source.repository);
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
    const normalized = normalizeWorkerResult(
      { ...request, config: workerConfig },
      imported,
      trustedSourceSha256,
    );
    if (!normalized.ok) {
      record(
        normalized.kind === 'source'
          ? sourceHashMismatch(request.runId)
          : normalized.kind === 'verifier'
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
    // DG-07 (#251, C-1 + C-2 + C-6a): build the deterministic ledger from the
    // IMPORTED artifacts (worker lane: nested `artifacts/checkpoints/RUNID/`
    // layout), redaction-scan its bytes, and write it at the run root. For a
    // verified candidate the ledger content then rides INSIDE the frozen
    // single-file bundle (this lane has no assembled directory) — a staging
    // failure blocks promotion fail-closed.
    //
    // Remediation (#251 review P1): NO skipIfPresent here — the run root is
    // caller-controlled (`--out`/`--run-id`), so a pre-existing schema-valid
    // intents.json is untrusted caller input. The ledger is ALWAYS rebuilt
    // from the imported stage artifacts and redaction-scanned; a planted
    // ledger (fabricated `verified` states, secret strings) is overwritten,
    // never kept (mirrors the local verify callback).
    const runRoot = resolve(request.runDirectory, request.runId);
    const ledger = await stageIntentLedger({
      runDirectory: runRoot,
      generatedAt: (request.now ?? (() => new Date().toISOString()))(),
      scan: scanTextForSecrets,
    });
    if (!ledger.ok) {
      for (const diagnostic of ledger.diagnostics) record(diagnostic);
      if (state.outcome === 'verified') return failedResult(request, diagnostics);
    }
    if (state.outcome === 'verified') {
      if (!normalized.stagedBundle) {
        record(protocolFailure(request.runId));
        return failedResult(request, diagnostics);
      }
      if (!ledger.ok) {
        // Verified candidates never promote without the ledger (C-2); the
        // ledger diagnostics were already recorded above.
        return failedResult(request, diagnostics);
      }
      try {
        const receipt = await promoteWorkerCandidate({
          bundle: withEmbeddedLedger(
            promotableBundle(normalized.stagedBundle, request.runDirectory, request.runId),
            ledger,
            runRoot,
          ),
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

function promotableBundle(bundle: StagedBundle, runDirectory: string, runId: string): StagedBundle {
  const root = resolve(runDirectory, runId, 'artifacts');
  const rewrite = (path: string): string => (isAbsolute(path) ? path : resolve(root, path));
  return {
    ...bundle,
    artifacts: bundle.artifacts.map((artifact) => ({
      ...artifact,
      path: rewrite(artifact.path),
    })),
    manifest: {
      ...bundle.manifest,
      fileHashes: bundle.manifest.fileHashes.map((hash) => ({
        ...hash,
        path: rewrite(hash.path),
      })),
    },
  };
}

/**
 * The frozen worker bundle carries the ledger CONTENT inside its bytes (D-2:
 * this lane has NO assembled directory) — as the staged `intent-ledger`
 * artifact ref (absolute run-root path, riding `manifest.fileHashes`) PLUS the
 * full ledger document under `intentsLedger`, hash-covered by the freeze
 * (receipt `checksumSha256` = sha256 over the frozen bytes). No manifest
 * schema change (D-1): `intentsLedger` is a bundle-level field.
 */
function withEmbeddedLedger(
  bundle: StagedBundle,
  ledger: Extract<StageIntentLedgerOutcome, { ok: true }>,
  runRoot: string,
): StagedBundle & { intentsLedger: IntentLedger } {
  const artifact: ArtifactRef = {
    kind: 'intent-ledger',
    path: join(runRoot, 'intents.json'),
    sha256: ledger.sha256,
  };
  return {
    ...bundle,
    artifacts: [...bundle.artifacts, artifact],
    manifest: {
      ...bundle.manifest,
      fileHashes: [...bundle.manifest.fileHashes, { path: artifact.path, sha256: artifact.sha256 }],
    },
    intentsLedger: ledger.ledger,
  };
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

function sourceHashMismatch(runId: string): Diagnostic {
  return cliDiagnostic(
    ARXIC_EXEC_WORKER_SOURCE_MISMATCH,
    'blocked',
    runId,
    'Worker source bytes do not match the trusted staged source; promotion was refused',
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
