import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '@arxic/contracts';
import type { RunExecutor, RunRequest, RunResult } from '../executor';
import { cliDiagnostic, ARXIC_EXEC_RESUMED } from '../diagnostics';
import { runAction } from '../run';
import { OBSERVED_DIAGNOSTIC, VALID_YAML, runState } from './fixtures';

const execute = promisify(execFile);

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

  it.each(['.arxic/\n', ''])(
    'keeps default output outside a repository regardless of its .gitignore (%j)',
    async (gitignore) => {
      const directory = await configDirectory();
      await writeFile(join(directory, '.gitignore'), gitignore);
      await commitRepository(directory);
      const firstRunId = `default-output-first-${randomUUID()}`;
      const secondRunId = `default-output-second-${randomUUID()}`;

      const first = await runAction({
        configPath: 'arxic.yaml',
        runId: firstRunId,
        executor: resultExecutor([], 'verified'),
        cwd: directory,
        now: sequenceClock(),
      });
      const second = await runAction({
        configPath: 'arxic.yaml',
        runId: secondRunId,
        executor: resultExecutor([], 'verified'),
        cwd: directory,
        now: sequenceClock(),
      });

      expect(first.exitCode).toBe(0);
      expect(second.exitCode).toBe(0);
      expect(first.runDirectory).toMatch(new RegExp(`arxic-runs-.+/${firstRunId}$`, 'u'));
      expect(second.runDirectory).toMatch(new RegExp(`arxic-runs-.+/${secondRunId}$`, 'u'));
      expect(dirname(first.runDirectory!)).not.toBe(dirname(second.runDirectory!));
      expect((await stat(dirname(first.runDirectory!))).mode & 0o777).toBe(0o700);
      expect((await stat(dirname(second.runDirectory!))).mode & 0o777).toBe(0o700);
      expect((await execute('git', ['status', '--porcelain'], { cwd: directory })).stdout).toBe('');
      await Promise.all([
        rm(dirname(first.runDirectory!), { recursive: true, force: true }),
        rm(dirname(second.runDirectory!), { recursive: true, force: true }),
      ]);
    },
  );
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

async function commitRepository(directory: string): Promise<void> {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Arxic Test',
    GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
    GIT_COMMITTER_NAME: 'Arxic Test',
    GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
  };
  await execute('git', ['init', '--initial-branch=main'], { cwd: directory, env });
  await execute('git', ['add', '.'], { cwd: directory, env });
  await execute('git', ['commit', '-m', 'CLI test repository'], { cwd: directory, env });
}

function sequenceClock(): () => string {
  let second = 0;
  return () => `2026-08-07T10:00:0${second++}.000Z`;
}
