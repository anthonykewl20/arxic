import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunHandle, RunStreamEvent, WorkerClient } from '@arxic/worker';
import { WorkerRunExecutor } from '../worker-executor';
import type { RunRequest } from '../executor';
import { VALID_CONFIG } from './fixtures';

const request: RunRequest = {
  runId: 'worker-test',
  config: VALID_CONFIG,
  runDirectory: '/tmp/arxic-worker-test',
  rulepacksDir: '/tmp/rulepacks',
};
const running: RunHandle = {
  runId: request.runId,
  status: 'running',
  outcome: 'observed',
  diagnostics: [],
  promotionEligible: false,
};

describe('WorkerRunExecutor sad paths', () => {
  it('blocks startup interruption without exposing raw worker prose', async () => {
    const client = workerClient({ start: async () => Promise.reject(new Error('SECRET worker')) });
    const emitted: string[] = [];
    const result = await new WorkerRunExecutor(client).execute(request, {
      emit: (diagnostic) => emitted.push(diagnostic.message),
    });
    expect(result).toMatchObject({ status: 'failed', outcome: 'blocked' });
    expect(result.diagnostics.map(({ code }) => code)).toEqual(['ARXIC-EXEC-WORKER-INTERRUPTED']);
    expect(emitted.join(' ')).not.toContain('SECRET');
  });

  it('cancels and blocks a stream interruption, preserving cleanup diagnostics', async () => {
    let canceled = false;
    const cleanup = {
      code: 'ARXIC-WORKER-CLEANUP-FAILED',
      severity: 'blocked',
      subject: 'SECRET provider subject',
      message: 'raw docker daemon output SECRET',
    } as const;
    const client = workerClient({
      stream: () => interruptedStream(),
      cancel: async () => {
        canceled = true;
        return { ...running, status: 'failed', outcome: 'blocked', diagnostics: [cleanup] };
      },
    });
    const result = await new WorkerRunExecutor(client).execute(request, { emit() {} });
    expect(canceled).toBe(true);
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      'ARXIC-EXEC-WORKER-INTERRUPTED',
      'ARXIC-WORKER-CLEANUP-FAILED',
    ]);
    expect(JSON.stringify(result.diagnostics)).not.toContain('SECRET');
  });

  it('blocks an approval event rather than trusting worker prose', async () => {
    const client = workerClient({
      stream: () =>
        events({
          type: 'awaiting-approval',
          stage: 8,
          message: 'approve SECRET destructive action',
        }),
    });
    const result = await new WorkerRunExecutor(client).execute(request, { emit() {} });
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      'ARXIC-EXEC-WORKER-APPROVAL-REQUIRED',
    );
    expect(JSON.stringify(result.diagnostics)).not.toContain('SECRET');
  });

  it('reclassifies an unrecognized worker diagnostic without exposing its fields', async () => {
    const completed = { ...running, status: 'completed' } as const;
    const client = workerClient({
      stream: () =>
        events(
          {
            type: 'diagnostic',
            diagnostic: {
              code: 'ARXIC-MODEL-UNEXPECTED',
              severity: 'blocked',
              subject: 'SECRET subject',
              message: 'SECRET provider prose',
            },
          },
          { type: 'finished', handle: completed },
        ),
      inspect: async () => completed,
    });
    const result = await new WorkerRunExecutor(client).execute(request, { emit() {} });
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      'ARXIC-EXEC-WORKER-INTERRUPTED',
      'ARXIC-WORKER-RUN-FAILED',
      'ARXIC-EXEC-WORKER-PROTOCOL',
    ]);
    expect(JSON.stringify(result.diagnostics)).not.toContain('SECRET');
  });

  it('blocks the current no-op completed handle because no pipeline result exists', async () => {
    const completed = { ...running, status: 'completed' } as const;
    const client = workerClient({
      stream: () => events({ type: 'finished', handle: completed }),
      inspect: async () => completed,
    });
    const result = await new WorkerRunExecutor(client).execute(request, { emit() {} });
    expect(result).toMatchObject({ status: 'failed', outcome: 'blocked' });
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      'ARXIC-WORKER-RUN-FAILED',
      'ARXIC-EXEC-WORKER-PROTOCOL',
    ]);
    expect(result.state.checkpoints).toEqual([]);
    expect(result.state.artifacts).toEqual({});
    expect(result.receipt).toBeUndefined();
  });

  it('writes validated result-ready bytes to the sibling artifacts directory without changing run JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-worker-ingress-'));
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const manifest = {
      runId: request.runId,
      resultReady: true,
      files: [{ path: 'screens/proof.png', sha256, bytes: bytes.length }],
    } as const;
    const completed = { ...running, status: 'completed' } as const;
    const client = workerClient({
      stream: () =>
        events({ type: 'result-ready', manifest }, { type: 'finished', handle: completed }),
      collectArtifacts: async () => ({
        manifest,
        files: [{ path: manifest.files[0].path, sha256, bytes }],
      }),
      inspect: async () => completed,
    });
    try {
      const result = await new WorkerRunExecutor(client).execute(
        { ...request, runDirectory: directory },
        { emit() {} },
      );
      expect(await readFile(join(directory, request.runId, 'artifacts/screens/proof.png'))).toEqual(
        bytes,
      );
      // #157 still owns PipelineResult normalization, so lifecycle completion
      // remains blocked by the existing protocol diagnostic in this slice.
      expect(result.diagnostics.map(({ code }) => code)).toEqual(['ARXIC-EXEC-WORKER-PROTOCOL']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function workerClient(overrides: Partial<WorkerClient>): WorkerClient {
  return {
    start: async () => running,
    stream: () => events({ type: 'finished', handle: running }),
    collectArtifacts: async () => Promise.reject(new Error('not ready')),
    inspect: async (handle) => handle,
    approve: async (handle) => handle,
    cancel: async (handle) => ({ ...handle, status: 'failed', outcome: 'blocked' }),
    ...overrides,
  };
}

async function* events(...items: RunStreamEvent[]): AsyncIterable<RunStreamEvent> {
  yield* items;
}

function interruptedStream(): AsyncIterable<RunStreamEvent> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: async () => Promise.reject(new Error('SECRET stream failure')),
      };
    },
  };
}
