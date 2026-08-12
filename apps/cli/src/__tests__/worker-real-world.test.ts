import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { validateDiagnostic } from '@arxic/contracts';
import { createLocalWorkerClient, type WorkerClient } from '@arxic/worker';
import { afterAll, describe, expect, it } from 'vitest';
import { runCli } from '../cli';

const execute = promisify(execFile);
const directories: string[] = [];

afterAll(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('worker-backed CLI real Docker proof', () => {
  it('imports and normalizes the synthetic envelope through real Docker without claiming verified', async () => {
    const version = await docker(['version', '--format', '{{.Server.Version}}']);
    expect(version.exit, version.stderr).toBe(0);

    const directory = await temporaryDirectory('arxic-worker-cli-');
    const source = await temporaryDirectory('arxic-worker-source-');
    await writeFile(join(source, 'source.txt'), 'worker lifecycle proof');
    await writeConfig(join(directory, 'arxic.yaml'), source);
    const runId = `worker-cli-${process.pid}`;
    // node:20-alpine keeps this lifecycle/mechanics proof CI-portable (the
    // real arxic-worker image is exercised by worker-image.real-world.test.ts).
    const actualClient = createLocalWorkerClient({ image: 'node:20-alpine' });
    let workerObserved = false;
    const workerClient: WorkerClient = {
      ...actualClient,
      async *stream(handle) {
        const inspected = await docker([
          'inspect',
          '--format',
          '{{.HostConfig.ReadonlyRootfs}} {{.Config.User}}',
          `arxic-${handle.runId}-worker`,
        ]);
        workerObserved = inspected.exit === 0 && inspected.stdout.startsWith('true ');
        yield* actualClient.stream(handle);
      },
    };
    const errors: string[] = [];
    const result = await runCli(
      ['run', '--config', 'arxic.yaml', '--executor', 'worker', '--out', 'runs', '--run-id', runId],
      {
        cwd: directory,
        workerClient,
        stderr: { write: (message) => void errors.push(message) },
      },
    );

    expect(workerObserved).toBe(true);
    expect(result).toEqual({ exitCode: 1, runDirectory: join(directory, 'runs', runId) });
    expect(errors.join('')).not.toContain('ARXIC-EXEC-WORKER-PROTOCOL');
    expect((await docker(['inspect', `arxic-${runId}-worker`])).exit).not.toBe(0);
    expect((await docker(['network', 'inspect', `arxic-${runId}-net`])).exit).not.toBe(0);

    const runDirectory = result.runDirectory!;
    expect((await readdir(runDirectory)).sort()).toEqual([
      'artifacts',
      'config.json',
      'diagnostics.jsonl',
      'run.json',
    ]);
    expect(await readdir(join(runDirectory, 'artifacts'))).toEqual(['pipeline-result.json']);
    const run = JSON.parse(await readFile(join(runDirectory, 'run.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(Object.keys(run).sort()).toEqual([
      'artifactHashes',
      'config',
      'decisions',
      'diagnostics',
      'finishedAt',
      'gateResults',
      'generator',
      'outcome',
      'redaction',
      'runId',
      'schemaVersion',
      'stages',
      'startedAt',
      'status',
      'target',
      'toolVersions',
    ]);
    expect(run).toMatchObject({
      schemaVersion: 1,
      runId,
      status: 'partial',
      outcome: 'observed',
      stages: expect.arrayContaining([expect.objectContaining({ stage: 10 })]),
      artifactHashes: [],
    });
    expect(run).not.toHaveProperty('receipt');
    const diagnosticBytes = (
      await readFile(join(runDirectory, 'diagnostics.jsonl'), 'utf8')
    ).trim();
    const diagnostics = diagnosticBytes
      ? diagnosticBytes.split('\n').map((line) => JSON.parse(line) as unknown)
      : [];
    expect(diagnostics).toHaveLength(0);
    expect(diagnostics.every((diagnostic) => validateDiagnostic(diagnostic).ok)).toBe(true);
    expect(JSON.parse(await readFile(join(runDirectory, 'config.json'), 'utf8'))).toMatchObject({
      version: 1,
      source: { repository: source },
    });
  }, 120_000);
});

async function docker(args: readonly string[]): Promise<{
  exit: number;
  stdout: string;
  stderr: string;
}> {
  try {
    const result = await execute('docker', [...args], { timeout: 60_000 });
    return { exit: 0, stdout: result.stdout.trimEnd(), stderr: result.stderr.trimEnd() };
  } catch (error) {
    const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
    return {
      exit: typeof failure.code === 'number' ? failure.code : 1,
      stdout: String(failure.stdout ?? '').trimEnd(),
      stderr: String(failure.stderr ?? failure.message).trimEnd(),
    };
  }
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

async function writeConfig(path: string, repository: string): Promise<void> {
  await writeFile(
    path,
    `version: 1
source:
  repository: ${JSON.stringify(repository)}
  revision: HEAD
  languages: [typescript]
scope:
  domains: [authentication]
  frameworks: [nextjs]
  browsers: [chromium]
  personas: [anonymous]
target:
  origin: http://127.0.0.1:3000
  environmentClass: local-test
  attestationPath: /.well-known/arxic-test-target.json
  allowedOrigins: [http://127.0.0.1:3000]
policy:
  maxUrls: 8
  maxDepth: 1
  maxRuntimeMinutes: 1
  mutation: leased-fixtures-only
  externalNetwork: deny
  requiredVerificationRuns: 2
  screenshots: transition-checkpoints
  trace: retain
  humanApproval: [destructive]
fixtures:
  personaProvisioner: app-seed-api
models:
  provider: configured-adapter
  sourceRetention: disabled
`,
  );
}
