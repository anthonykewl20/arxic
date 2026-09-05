import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { RunExecutor } from '../executor';
import { runCli } from '../cli';
import { OBSERVED_DIAGNOSTIC, VALID_YAML, runState } from './fixtures';

describe('runCli', () => {
  it('prints the package version', async () => {
    const output: string[] = [];
    const result = await runCli(['--version'], { stdout: writer(output) });
    expect(result).toEqual({ exitCode: 0 });
    expect(output.join('')).toBe('v0.0.200\n');
  });

  it('prints usage help', async () => {
    const output: string[] = [];
    const result = await runCli(['--help'], { stdout: writer(output) });
    expect(result.exitCode).toBe(0);
    expect(output.join('')).toContain('Usage: arxic');
    expect(output.join('')).toContain('run --config <path>');
  });

  it('reports malformed config with a stable code and no stack trace', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-cli-bad-'));
    await writeFile(join(directory, 'arxic.yaml'), 'version: [bad\n');
    const errors: string[] = [];
    const result = await runCli(['run', '--config', 'arxic.yaml'], {
      cwd: directory,
      executor: fakeExecutor(),
      stderr: writer(errors),
    });
    expect(result).toEqual({ exitCode: 2 });
    expect(errors.join('')).toContain('ARXIC-CONFIG-PARSE');
    expect(errors.join('')).not.toContain(' at ');
  });

  it('runs from a real config file and writes the run directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-cli-real-'));
    await writeFile(join(directory, 'arxic.yaml'), VALID_YAML);
    const errors: string[] = [];
    const output: string[] = [];
    const result = await runCli(
      ['run', '--config', 'arxic.yaml', '--out', 'runs', '--run-id', 'cli-test-run'],
      {
        cwd: directory,
        executor: fakeExecutor(),
        stdout: writer(output),
        stderr: writer(errors),
        now: sequenceClock(),
      },
    );
    expect(result).toEqual({ exitCode: 1, runDirectory: join(directory, 'runs', 'cli-test-run') });
    expect(errors.join('')).toContain('ARXIC-ORCH-TEST-OBSERVED');
    expect(output.join('')).toBe(
      `arxic run cli-test-run -> ${join(directory, 'runs', 'cli-test-run')} (status=completed, outcome=observed)\n`,
    );
  });

  it('returns exit 0 and prints completion for a verified run', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-cli-verified-'));
    await writeFile(join(directory, 'arxic.yaml'), VALID_YAML);
    const output: string[] = [];
    const result = await runCli(
      ['run', '--config', 'arxic.yaml', '--out', 'runs', '--run-id', 'verified-run'],
      {
        cwd: directory,
        executor: fakeExecutor('verified'),
        stdout: writer(output),
        now: sequenceClock(),
      },
    );
    expect(result).toEqual({ exitCode: 0, runDirectory: join(directory, 'runs', 'verified-run') });
    expect(output.join('')).toBe(
      `arxic run verified-run -> ${join(directory, 'runs', 'verified-run')} (status=completed, outcome=verified)\n`,
    );
  });
});

function fakeExecutor(outcome: 'observed' | 'verified' = 'observed'): RunExecutor {
  return {
    async execute(request, sink) {
      const diagnostics = outcome === 'observed' ? [OBSERVED_DIAGNOSTIC] : [];
      diagnostics.forEach((diagnostic) => sink.emit(diagnostic));
      return {
        runId: request.runId,
        status: 'completed',
        outcome,
        diagnostics,
        runDirectory: request.runDirectory,
        state: { ...runState(diagnostics, outcome), runId: request.runId },
      };
    },
  };
}

function writer(output: string[]): { write(message: string): void } {
  return { write: (message) => void output.push(message) };
}

function sequenceClock(): () => string {
  let second = 0;
  return () => `2026-08-07T10:00:0${second++}.000Z`;
}
