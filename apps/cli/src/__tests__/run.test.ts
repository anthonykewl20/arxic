import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '@arxic/contracts';
import type { RunExecutor, RunRequest, RunResult } from '../executor';
import { cliDiagnostic, ARXIC_EXEC_RESUMED } from '../diagnostics';
import { runAction } from '../run';
import { OBSERVED_DIAGNOSTIC, VALID_YAML, runState } from './fixtures';

describe('runAction sad paths', () => {
  it('returns exit 2 and writes no run directory for malformed config', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-action-bad-'));
    await writeFile(join(directory, 'arxic.yaml'), 'version: [bad\n');
    const outcome = await runAction({
      configPath: 'arxic.yaml',
      out: 'runs',
      runId: 'bad-config',
      executor: successfulExecutor(),
      cwd: directory,
    });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.diagnostics[0].code).toBe('ARXIC-CONFIG-PARSE');
    await expect(access(join(directory, 'runs', 'bad-config'))).rejects.toThrow();
  });

  it('fails closed when model configuration is absent', async () => {
    const directory = await configDirectory(VALID_YAML.replace(/models:\n[\s\S]*$/u, ''));
    const outcome = await runAction({
      configPath: 'arxic.yaml',
      executor: successfulExecutor(),
      cwd: directory,
    });
    expect(outcome.exitCode).toBe(2);
    expect(outcome.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'ARXIC-CONFIG-MODEL-MISSING',
    );
  });

  it('classifies an executor crash as blocked and preserves a partial run directory', async () => {
    const directory = await configDirectory();
    const executor: RunExecutor = {
      execute: async () => Promise.reject(new Error('secret stack')),
    };
    const outcome = await runAction({
      configPath: 'arxic.yaml',
      out: 'runs',
      runId: 'crashed',
      executor,
      cwd: directory,
      now: sequenceClock(),
    });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'ARXIC-EXEC-CRASH', severity: 'blocked' }),
    );
    const runBytes = await readFile(join(directory, 'runs', 'crashed', 'run.json'), 'utf8');
    expect(runBytes).toContain('ARXIC-EXEC-CRASH');
    expect(runBytes).not.toContain('secret stack');
  });

  it('writes an honest exit-1 record for a blocked pipeline outcome', async () => {
    const directory = await configDirectory();
    const blocked: Diagnostic = {
      code: 'ARXIC-ORCH-TARGET-UNREACHABLE',
      severity: 'blocked',
      subject: 'target',
      message: 'Target was unreachable',
    };
    const outcome = await runAction({
      configPath: 'arxic.yaml',
      out: 'runs',
      runId: 'blocked-run',
      executor: resultExecutor([blocked], 'blocked'),
      cwd: directory,
      now: sequenceClock(),
    });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.runDirectory).toBe(join(directory, 'runs', 'blocked-run'));
    expect(outcome.diagnostics).toEqual([blocked]);
  });

  it('records a worker restart and resumed result in emission order', async () => {
    const directory = await configDirectory();
    const resumed = cliDiagnostic(
      ARXIC_EXEC_RESUMED,
      'observed',
      'resumed-run',
      'Resumed from checkpoint',
    );
    const executor: RunExecutor = {
      async execute(request, sink) {
        sink.emit(resumed);
        sink.emit(OBSERVED_DIAGNOSTIC);
        return makeResult(request, [resumed, OBSERVED_DIAGNOSTIC]);
      },
    };
    const recorded: string[] = [];
    const outcome = await runAction({
      configPath: 'arxic.yaml',
      out: 'runs',
      runId: 'resumed-run',
      executor,
      sink: { emit: (diagnostic) => recorded.push(diagnostic.code) },
      cwd: directory,
      now: sequenceClock(),
    });
    expect(outcome.exitCode).toBe(1);
    expect(recorded).toEqual(['ARXIC-EXEC-RESUMED', 'ARXIC-ORCH-TEST-OBSERVED']);
  });
});

describe('runAction happy path', () => {
  it('streams diagnostics in order and writes a completed observed run', async () => {
    const directory = await configDirectory();
    const first = { ...OBSERVED_DIAGNOSTIC, code: 'ARXIC-ORCH-FIRST' };
    const second = { ...OBSERVED_DIAGNOSTIC, code: 'ARXIC-ORCH-SECOND' };
    const recorded: string[] = [];
    const outcome = await runAction({
      configPath: 'arxic.yaml',
      out: 'runs',
      runId: 'completed-run',
      executor: resultExecutor([first, second]),
      sink: { emit: (diagnostic) => recorded.push(diagnostic.code) },
      cwd: directory,
      now: sequenceClock(),
    });
    expect(outcome).toMatchObject({
      exitCode: 1,
      runDirectory: join(directory, 'runs', 'completed-run'),
    });
    expect(recorded).toEqual(['ARXIC-ORCH-FIRST', 'ARXIC-ORCH-SECOND']);
    const lines = (
      await readFile(join(directory, 'runs', 'completed-run', 'diagnostics.jsonl'), 'utf8')
    )
      .trim()
      .split('\n')
      .map((line) => (JSON.parse(line) as Diagnostic).code);
    expect(lines).toEqual(recorded);
  });

  it('returns exit 0 for a verified run', async () => {
    const directory = await configDirectory();
    const outcome = await runAction({
      configPath: 'arxic.yaml',
      out: 'runs',
      runId: 'verified-run',
      executor: resultExecutor([], 'verified'),
      cwd: directory,
      now: sequenceClock(),
    });
    expect(outcome).toMatchObject({
      exitCode: 0,
      runDirectory: join(directory, 'runs', 'verified-run'),
      status: 'completed',
      outcome: 'verified',
    });
  });
});

function successfulExecutor(): RunExecutor {
  return resultExecutor([OBSERVED_DIAGNOSTIC]);
}

function resultExecutor(
  diagnostics: readonly Diagnostic[],
  outcome: 'observed' | 'blocked' | 'verified' = 'observed',
): RunExecutor {
  return {
    async execute(request, sink) {
      diagnostics.forEach((diagnostic) => sink.emit(diagnostic));
      return makeResult(request, diagnostics, outcome);
    },
  };
}

function makeResult(
  request: RunRequest,
  diagnostics: readonly Diagnostic[],
  outcome: 'observed' | 'blocked' | 'verified' = 'observed',
): RunResult {
  const state = { ...runState(diagnostics, outcome), runId: request.runId, outcome };
  return {
    runId: request.runId,
    status: 'completed',
    outcome,
    diagnostics,
    runDirectory: request.runDirectory,
    state,
  };
}

async function configDirectory(yaml = VALID_YAML): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-action-'));
  await writeFile(join(directory, 'arxic.yaml'), yaml);
  return directory;
}

function sequenceClock(): () => string {
  let second = 0;
  return () => `2026-08-07T10:00:0${second++}.000Z`;
}
