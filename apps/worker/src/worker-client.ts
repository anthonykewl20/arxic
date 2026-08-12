import { resolve } from 'node:path';
import {
  createWorkerSandbox,
  defaultQuotas,
  inspectSandbox,
  workerDiagnostic,
  type SandboxExecResult,
  type SandboxState,
  type WorkerSandbox,
} from '@arxic/environment';
import type {
  ImportedArtifacts,
  RunApproval,
  RunHandle,
  RunSpec,
  RunStreamEvent,
  WorkerClient,
} from './run-spec';
import {
  ArtifactImportError,
  DEFAULT_RESULT_QUOTA_BYTES,
  importArtifacts,
} from '@arxic/environment';
import { freezePolicy, ingestContentAsData, validateWorkerSecurity } from './worker-policy';

/**
 * Classify an inspected sandbox state into a run handle. A quota breach
 * (OOMKilled) maps to `ARXIC-WORKER-QUOTA-EXCEEDED`; any other exit (the
 * keepalive died or a step failed) maps to `ARXIC-WORKER-RUN-FAILED`. The
 * `ARXIC-WORKER-ISOLATION-VIOLATED` code is reserved for sandbox *creation*
 * failure / escape evidence (see {@link createLocalWorkerClient}.start) and is
 * never used for an ordinary run failure, so incident triage is not misled.
 */
export function classifySandboxState(handle: RunHandle, state: SandboxState): RunHandle {
  if (state.oomKilled) {
    return blocked(
      handle,
      'ARXIC-WORKER-QUOTA-EXCEEDED',
      handle.runId,
      'Worker exceeded its memory quota ' +
        `(OOMKilled=${state.oomKilled}, exitCode=${state.exitCode}).`,
    );
  }
  if (state.status === 'exited') {
    return blocked(
      handle,
      'ARXIC-WORKER-RUN-FAILED',
      handle.runId,
      `Worker exited unexpectedly with code ${state.exitCode}.`,
    );
  }
  return handle;
}

/** Classify the result of a command executed inside the sandbox. */
export function classifyExecResult(handle: RunHandle, result: SandboxExecResult): RunHandle {
  if (result.oomKilled) {
    return blocked(
      handle,
      'ARXIC-WORKER-QUOTA-EXCEEDED',
      handle.runId,
      'Worker exceeded its memory quota during execution.',
    );
  }
  if (result.timedOut) {
    return blocked(
      handle,
      'ARXIC-WORKER-TIMEOUT',
      handle.runId,
      `Worker exceeded its wall-clock quota (timeoutMs).`,
    );
  }
  if (result.exit !== 0) {
    return blocked(
      handle,
      'ARXIC-WORKER-RUN-FAILED',
      handle.runId,
      `Worker command exited with code ${result.exit}.`,
    );
  }
  return handle;
}

function blocked(
  handle: RunHandle,
  code: Parameters<typeof workerDiagnostic>[0],
  subject: string,
  message: string,
): RunHandle {
  return {
    ...handle,
    status: 'failed',
    outcome: 'blocked',
    diagnostics: [...handle.diagnostics, workerDiagnostic(code, subject, message)],
    promotionEligible: false,
  };
}

/** Command that reads representative source text so it can be ingested as data. */
const INGEST_SOURCE_TEXT = [
  'sh',
  '-c',
  "find /work/source -type f \\( -name '*.md' -o -name '*.txt' -o -name '*.json' \\) -exec cat {} + 2>/dev/null || true",
];

export function createLocalWorkerClient(options: { docker?: boolean } = {}): WorkerClient {
  const dockerEnabled = options.docker !== false;
  const handles = new Map<string, RunHandle>();
  const sandboxes = new Map<string, WorkerSandbox>();
  const policies = new Map<string, ReturnType<typeof freezePolicy>>();
  const approvals = new Map<string, readonly RunApproval[]>();
  const importedArtifacts = new Map<string, ImportedArtifacts>();

  const remember = (handle: RunHandle): RunHandle => {
    handles.set(handle.runId, handle);
    return handle;
  };

  return {
    async start(spec: RunSpec): Promise<RunHandle> {
      const security = validateWorkerSecurity(spec);
      if (!security.ok) {
        return remember({
          runId: spec.runId,
          status: 'failed',
          outcome: 'blocked',
          diagnostics: security.diagnostics,
          promotionEligible: false,
        });
      }
      // ADR §16.3 / threat-model §"Prompt-injection defense": the run policy is
      // frozen before any untrusted content is read and is never mutated.
      policies.set(spec.runId, freezePolicy(spec));

      if (handles.has(spec.runId)) {
        return handles.get(spec.runId)!;
      }

      if (dockerEnabled) {
        try {
          // ADR §19 repositories are paths relative to the trusted launcher.
          // In particular, repository "." resolves to process.cwd(). Isolation
          // is enforced by construction in createWorkerSandbox (non-root,
          // read-only, cap-drop ALL, internal network, no socket); the spec is
          // not consulted for sandbox flags.
          const sourcePath = resolve(process.cwd(), spec.config.source.repository);
          const sandbox = await createWorkerSandbox({
            jobId: spec.runId,
            sourcePath,
            quotas: defaultQuotas(spec.config.policy.maxRuntimeMinutes),
            networkName: `arxic-${spec.runId}-net`,
            resultVolume: {
              mountPath: '/work/result',
              quotaBytes: DEFAULT_RESULT_QUOTA_BYTES,
            },
          });
          sandboxes.set(spec.runId, sandbox);
        } catch (error) {
          return remember(
            blocked(
              {
                runId: spec.runId,
                status: 'running',
                outcome: 'observed',
                diagnostics: [],
                promotionEligible: false,
              },
              'ARXIC-WORKER-ISOLATION-VIOLATED',
              spec.runId,
              `Could not create isolated worker: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
      }

      return remember({
        runId: spec.runId,
        status: 'running',
        outcome: 'observed',
        activeStage: 0,
        diagnostics: [],
        promotionEligible: false,
      });
    },

    async *stream(handle: RunHandle): AsyncIterable<RunStreamEvent> {
      let latest = handles.get(handle.runId) ?? handle;
      yield {
        type: 'stage-started',
        stage: 0,
        name: 'sandbox-up',
        startedAt: new Date().toISOString(),
      };
      for (const diagnostic of latest.diagnostics) yield { type: 'diagnostic', diagnostic };

      const sandbox = sandboxes.get(handle.runId);
      const policy = policies.get(handle.runId);
      if (sandbox && policy) {
        // Content-is-data: ingest source text as data against the frozen
        // policy. Injection-shaped content is recorded, never executed; the
        // policy reference is returned unchanged (verified in worker-policy.test).
        try {
          const content = await sandbox.exec(INGEST_SOURCE_TEXT);
          // Route the ingestion exec through failure classification so a
          // timeout/OOM/non-zero ingestion is labeled correctly (TIMEOUT /
          // QUOTA-EXCEEDED / RUN-FAILED), not silently swallowed.
          latest = remember(classifyExecResult(latest, content));
          if (latest.status === 'failed' && latest.diagnostics.at(-1)) {
            yield { type: 'diagnostic', diagnostic: latest.diagnostics.at(-1)! };
          }
          if (latest.status !== 'failed') {
            const ingestion = ingestContentAsData(policy, content.stdout, 'source');
            for (const diagnostic of ingestion.diagnostics) {
              latest = remember({ ...latest, diagnostics: [...latest.diagnostics, diagnostic] });
              yield { type: 'diagnostic', diagnostic };
            }
          }
        } catch {
          // The sandbox may have already exited; classification below handles it.
        }

        try {
          const state = await inspectSandbox(sandbox);
          latest = remember(classifySandboxState(latest, state));
          if (latest.status === 'failed' && latest.diagnostics.at(-1)) {
            yield { type: 'diagnostic', diagnostic: latest.diagnostics.at(-1)! };
          }
        } catch (error) {
          const diagnostic = workerDiagnostic(
            'ARXIC-WORKER-RUN-FAILED',
            handle.runId,
            `Could not inspect isolated worker: ${error instanceof Error ? error.message : String(error)}`,
          );
          latest = remember(
            blocked(latest, 'ARXIC-WORKER-RUN-FAILED', handle.runId, diagnostic.message),
          );
          yield { type: 'diagnostic', diagnostic };
        }

        if (latest.status !== 'failed') {
          try {
            // #156's minimal handshake. The pipeline-result slice (#157) owns
            // extending this manifest with its sealed result references; until
            // then the scaffold worker has no bulk pipeline artifacts.
            const manifest = Buffer.from(
              JSON.stringify({ runId: handle.runId, resultReady: true, files: [] }),
            ).toString('base64');
            const published = await sandbox.exec([
              'sh',
              '-c',
              `printf %s '${manifest}' | base64 -d > /work/result/result-manifest.json`,
            ]);
            latest = remember(classifyExecResult(latest, published));
            if (latest.status === 'failed') throw new Error('Could not publish result manifest');
            const imported = importArtifacts(await sandbox.collectArtifacts(), handle.runId, {
              quotaBytes: DEFAULT_RESULT_QUOTA_BYTES,
            });
            importedArtifacts.set(handle.runId, imported);
            yield { type: 'result-ready', manifest: imported.manifest };
          } catch (error) {
            const quota = error instanceof ArtifactImportError && error.reason === 'quota';
            latest = remember(
              blocked(
                latest,
                quota ? 'ARXIC-WORKER-QUOTA-EXCEEDED' : 'ARXIC-WORKER-RUN-FAILED',
                handle.runId,
                quota
                  ? 'Worker artifact transport exceeded its enforced quota.'
                  : 'Worker artifact transport manifest was missing or corrupt.',
              ),
            );
            yield { type: 'diagnostic', diagnostic: latest.diagnostics.at(-1)! };
          }
        }

        // Deterministic cleanup: a completed run tears down its sandbox and
        // network regardless of success (threat-model "Cleanup is deterministic
        // and runs for success, refusal, timeout, cancellation, and crash").
        const cleanup = await sandbox.stop();
        if (cleanup.cleanupDiagnostics.length === 0) sandboxes.delete(handle.runId);
        if (cleanup.cleanupDiagnostics.length > 0) {
          latest = remember({
            ...latest,
            diagnostics: [...latest.diagnostics, ...cleanup.cleanupDiagnostics],
          });
          for (const diagnostic of cleanup.cleanupDiagnostics)
            yield { type: 'diagnostic', diagnostic };
        }
      }

      // A clean run (no blocking diagnostic) completes; otherwise it is failed.
      if (latest.status !== 'failed') {
        latest = remember({ ...latest, status: 'completed' });
      }
      yield { type: 'finished', handle: latest };
    },

    async collectArtifacts(handle: RunHandle): Promise<ImportedArtifacts> {
      const imported = importedArtifacts.get(handle.runId);
      if (!imported) throw new Error('No validated worker artifacts are ready');
      return imported;
    },

    async inspect(handle: RunHandle): Promise<RunHandle> {
      return handles.get(handle.runId) ?? handle;
    },

    async approve(handle: RunHandle, approval: RunApproval): Promise<RunHandle> {
      approvals.set(
        handle.runId,
        Object.freeze([...(approvals.get(handle.runId) ?? []), Object.freeze({ ...approval })]),
      );
      const latest = handles.get(handle.runId) ?? handle;
      return remember({ ...latest, status: 'running' });
    },

    async cancel(handle: RunHandle): Promise<RunHandle> {
      const latest = handles.get(handle.runId) ?? handle;
      const sandbox = sandboxes.get(handle.runId);
      const cleanup = sandbox ? await sandbox.stop() : { cleanupDiagnostics: [] };
      if (cleanup.cleanupDiagnostics.length === 0) sandboxes.delete(handle.runId);
      return remember({
        ...latest,
        status: 'failed',
        outcome: 'blocked',
        diagnostics: [...latest.diagnostics, ...cleanup.cleanupDiagnostics],
        promotionEligible: false,
      });
    },
  };
}
