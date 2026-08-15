import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { ArxicConfig } from '@arxic/worker';
import type { RunResult } from '../executor';
import { writeRunDirectory } from '../run-directory';
import { OBSERVED_DIAGNOSTIC, VALID_CONFIG, runState } from './fixtures';

describe('writeRunDirectory', () => {
  it('writes real canonical observability artifacts without secret-bearing config fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-run-directory-'));
    const state = runState();
    const result: RunResult = {
      runId: 'test-run',
      status: 'completed',
      outcome: 'observed',
      diagnostics: [OBSERVED_DIAGNOSTIC],
      runDirectory: directory,
      state,
    };
    const configWithFutureSecrets = {
      ...VALID_CONFIG,
      prompt: 'DO-NOT-PERSIST-PROMPT',
      credentialBytes: ['DO-NOT-PERSIST-CREDENTIAL'],
    } as ArxicConfig;

    await writeRunDirectory(directory, {
      runId: 'test-run',
      config: configWithFutureSecrets,
      result,
      startedAt: '2026-08-07T10:00:00.000Z',
      finishedAt: '2026-08-07T10:00:02.000Z',
      now: () => '2026-08-07T10:00:03.000Z',
    });

    const runBytes = await readFile(join(directory, 'test-run', 'run.json'), 'utf8');
    const run = JSON.parse(runBytes) as Record<string, unknown>;
    expect(run).toMatchObject({
      schemaVersion: 1,
      runId: 'test-run',
      generator: { id: '@arxic/cli', version: '0.1.1' },
      target: { origin: 'http://127.0.0.1:1', environmentClass: 'local-test' },
      status: 'completed',
      outcome: 'observed',
      startedAt: '2026-08-07T10:00:00.000Z',
      finishedAt: '2026-08-07T10:00:02.000Z',
      artifactHashes: [{ id: 'stage:0', sha256: 'a'.repeat(64) }],
      toolVersions: { chromium: '1.2.3', node: '22.0.0' },
      decisions: ['target attestation accepted', 'owner approved local target'],
      gateResults: [{ gate: 'attestation', passed: true }],
      redaction: { passed: true, redactedFields: ['request.authorization'] },
      diagnostics: [OBSERVED_DIAGNOSTIC],
    });
    expect((run.stages as unknown[]).length).toBe(1);
    expect(runBytes).not.toContain('DO-NOT-PERSIST');
    expect(runBytes.endsWith('\n')).toBe(true);
    expect(runBytes.startsWith('{"artifactHashes"')).toBe(true);
    // Characterize the previous run-directory serializer byte-for-byte. These files
    // are persisted observability artifacts, so the shared legacy mode must retain
    // its JSON.stringify omission and codepoint ordering behavior.
    expect(runBytes).toBe(`${previousRunDirectoryJson(run)}\n`);

    const diagnosticLines = (
      await readFile(join(directory, 'test-run', 'diagnostics.jsonl'), 'utf8')
    )
      .trimEnd()
      .split('\n');
    expect(diagnosticLines).toHaveLength(1);
    expect(JSON.parse(diagnosticLines[0])).toEqual(OBSERVED_DIAGNOSTIC);
    expect(diagnosticLines[0].startsWith('{"code"')).toBe(true);

    const configBytes = await readFile(join(directory, 'test-run', 'config.json'), 'utf8');
    const echoedConfig = JSON.parse(configBytes) as ArxicConfig;
    expect(echoedConfig.source.languages).toEqual(['typescript', 'javascript']);
    expect(echoedConfig.target.origin).toBe('http://127.0.0.1:1');
    expect(run).not.toHaveProperty('config.prompt');
    expect(run).not.toHaveProperty('config.credentialBytes');
    expect(echoedConfig).not.toHaveProperty('prompt');
    expect(echoedConfig).not.toHaveProperty('credentialBytes');
    expect(configBytes).not.toContain('DO-NOT-PERSIST');
    expect(configBytes).toBe(`${previousRunDirectoryJson(echoedConfig)}\n`);
    expect(diagnosticLines[0]).toBe(previousRunDirectoryJson(OBSERVED_DIAGNOSTIC));
  });
});

function previousRunDirectoryJson(value: unknown): string {
  const serialized = JSON.stringify(sortPreviousRunDirectoryValue(value));
  if (serialized === undefined) throw new Error('Run record is not JSON serializable');
  return serialized;
}

function sortPreviousRunDirectoryValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortPreviousRunDirectoryValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, sortPreviousRunDirectoryValue(item)]),
    );
  }
  return value;
}
