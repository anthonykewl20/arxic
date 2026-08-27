/**
 * Regression coverage for #333: validate-records.ts's argv parser must
 * retain the directory positional regardless of whether --live-key-env is
 * present, and regardless of flag/positional ordering.
 *
 * Root cause (pre-fix): `main()` computed
 *   const liveKeyEnvIndex = args.indexOf('--live-key-env');
 *   const positional = args.filter(
 *     (argument, index) => !argument.startsWith('--') && index !== liveKeyEnvIndex + 1,
 *   );
 * When --live-key-env is absent, indexOf returns -1, so `liveKeyEnvIndex + 1`
 * is 0 — the filter unconditionally drops the directory positional at index
 * 0. Sad path first: the single-flag invocation (directory +
 * --allow-missing-live-key, no --live-key-env) is the case that must be
 * fixed; the existing --live-key-env-present workaround path must keep
 * working in both orderings.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseValidateRecordsArgs } from '../validate-records';

const exec = promisify(execFile);

/**
 * The CLI writes a pretty-printed JSON summary to stdout, then (when
 * --live-key-env is present) an additional plain-text scan-result line.
 * Extract just the JSON object (up to its top-level closing brace) so the
 * trailing log line doesn't break JSON.parse.
 */
function parseStdoutJson(stdout: string): { directory: string; records: number } {
  const lines = stdout.split('\n');
  const closingIndex = lines.indexOf('}');
  const jsonText = lines.slice(0, closingIndex + 1).join('\n');
  return JSON.parse(jsonText) as { directory: string; records: number };
}

describe('parseValidateRecordsArgs (unit)', () => {
  it('sad path: resolves the directory positional when --live-key-env is absent', () => {
    const parsed = parseValidateRecordsArgs(['/abs/evidence-dir', '--allow-missing-live-key']);
    expect(parsed.directory).toBe('/abs/evidence-dir');
    expect(parsed.liveKeyEnvPresent).toBe(false);
    expect(parsed.allowMissingLiveKey).toBe(true);
  });

  it('sad path: directory positional survives even as the only argument', () => {
    const parsed = parseValidateRecordsArgs(['/abs/evidence-dir']);
    expect(parsed.directory).toBe('/abs/evidence-dir');
    expect(parsed.liveKeyEnvPresent).toBe(false);
    expect(parsed.allowMissingLiveKey).toBe(false);
  });

  it('resolves the directory when --live-key-env VAR precedes it (existing workaround order)', () => {
    const parsed = parseValidateRecordsArgs([
      '/abs/evidence-dir',
      '--live-key-env',
      'ARXIC_MODEL_API_KEY',
      '--allow-missing-live-key',
    ]);
    expect(parsed.directory).toBe('/abs/evidence-dir');
    expect(parsed.liveKeyEnvPresent).toBe(true);
    expect(parsed.liveKeyEnv).toBe('ARXIC_MODEL_API_KEY');
    expect(parsed.allowMissingLiveKey).toBe(true);
  });

  it('resolves the directory when flags precede the positional (order-independent)', () => {
    const parsed = parseValidateRecordsArgs([
      '--live-key-env',
      'ARXIC_MODEL_API_KEY',
      '--allow-missing-live-key',
      '/abs/evidence-dir',
    ]);
    expect(parsed.directory).toBe('/abs/evidence-dir');
    expect(parsed.liveKeyEnvPresent).toBe(true);
    expect(parsed.liveKeyEnv).toBe('ARXIC_MODEL_API_KEY');
    expect(parsed.allowMissingLiveKey).toBe(true);
  });

  it('resolves the directory when --allow-missing-live-key alone precedes it', () => {
    const parsed = parseValidateRecordsArgs(['--allow-missing-live-key', '/abs/evidence-dir']);
    expect(parsed.directory).toBe('/abs/evidence-dir');
    expect(parsed.liveKeyEnvPresent).toBe(false);
    expect(parsed.allowMissingLiveKey).toBe(true);
  });

  it('treats a --live-key-env with no following value as present but empty, without eating the directory', () => {
    const parsed = parseValidateRecordsArgs(['/abs/evidence-dir', '--live-key-env']);
    expect(parsed.directory).toBe('/abs/evidence-dir');
    expect(parsed.liveKeyEnvPresent).toBe(true);
    expect(parsed.liveKeyEnv).toBe('');
  });
});

describe('validate-records.ts CLI (real subprocess, no mocks)', () => {
  let evidenceDir: string;

  beforeEach(async () => {
    evidenceDir = await mkdtemp(join(tmpdir(), 'arxic-validate-records-argv-'));
  });

  afterEach(async () => {
    await rm(evidenceDir, { recursive: true, force: true });
  });

  const scriptPath = join(__dirname, '..', 'validate-records.ts');
  // Mirrors the documented repro invocation:
  //   pnpm --filter @arxic/worker exec tsx <script> <args>
  const runScript = (args: readonly string[]) =>
    exec('pnpm', ['--filter', '@arxic/worker', 'exec', 'tsx', scriptPath, ...args]);

  it('sad path: scans the directory when only --allow-missing-live-key is passed (no --live-key-env)', async () => {
    const { stdout } = await runScript([evidenceDir, '--allow-missing-live-key']);
    const parsed = parseStdoutJson(stdout);
    expect(parsed.directory).toBe(evidenceDir);
    expect(parsed.records).toBe(0);
  }, 30_000);

  it('still works with the --live-key-env workaround present (regression guard)', async () => {
    const { stdout } = await runScript([
      evidenceDir,
      '--live-key-env',
      'ARXIC_VALIDATE_RECORDS_TEST_VAR_UNSET',
      '--allow-missing-live-key',
    ]);
    const parsed = parseStdoutJson(stdout);
    expect(parsed.directory).toBe(evidenceDir);
    expect(parsed.records).toBe(0);
  }, 30_000);

  it('still works with --live-key-env preceding the directory positional', async () => {
    const { stdout } = await runScript([
      '--live-key-env',
      'ARXIC_VALIDATE_RECORDS_TEST_VAR_UNSET',
      '--allow-missing-live-key',
      evidenceDir,
    ]);
    const parsed = parseStdoutJson(stdout);
    expect(parsed.directory).toBe(evidenceDir);
    expect(parsed.records).toBe(0);
  }, 30_000);
});
