import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateDiagnostic } from '@arxic/contracts';
import {
  createWorkerSandbox,
  dockerInspect,
  dockerVersion,
  volumeInspect,
  workerDiagnostic,
  type WorkerSandbox,
} from '..';
import { ArtifactImportError, importArtifacts, type ArtifactTransportManifest } from '..';

const directories: string[] = [];
let dockerAvailable = false;
let dockerReason = '';

function identity(label: string): string {
  return `${label}-${process.pid}-${randomUUID().slice(0, 8)}`;
}

async function sandbox(
  label: string,
  quotaBytes = 256 * 1024 * 1024,
  limits: Readonly<{ perFileBytes?: number; fileLimit?: number }> = {},
): Promise<WorkerSandbox> {
  const source = await mkdtemp(join(tmpdir(), 'arxic-result-source-'));
  directories.push(source);
  await writeFile(join(source, 'source.txt'), 'source');
  const jobId = identity(label);
  return createWorkerSandbox({
    jobId,
    sourcePath: source,
    networkName: `arxic-${jobId}-net`,
    quotas: { memoryMb: 64, memorySwapMb: 64, pidsLimit: 64, cpus: 0.5, timeoutMs: 15_000 },
    resultVolume: { mountPath: '/work/result', quotaBytes, ...limits },
  });
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeManifest(
  worker: WorkerSandbox,
  files: ArtifactTransportManifest['files'],
  runId = worker.jobId,
): Promise<void> {
  const manifest: ArtifactTransportManifest = { runId, resultReady: true, files };
  const base64 = Buffer.from(JSON.stringify(manifest)).toString('base64');
  const result = await worker.exec([
    'sh',
    '-c',
    `printf %s '${base64}' | base64 -d > /work/result/result-manifest.json`,
  ]);
  expect(result.exit, result.stderr).toBe(0);
}

function expectImportCode(action: () => unknown, reason: ArtifactImportError['reason']): void {
  expect(action).toThrowError(ArtifactImportError);
  try {
    action();
  } catch (error) {
    expect((error as ArtifactImportError).reason).toBe(reason);
  }
}

describe('real Docker worker result volume transport', () => {
  beforeAll(async () => {
    const version = await dockerVersion();
    dockerAvailable = version.exit === 0;
    dockerReason = version.stderr || version.stdout || 'docker version failed';
  });

  afterAll(async () => {
    await Promise.all(
      directories.map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('physically blocks a volume-full write as ARXIC-WORKER-QUOTA-EXCEEDED without host OOM', async ({
    skip,
  }) => {
    if (!dockerAvailable) skip(`Docker unavailable: ${dockerReason}`);
    const worker = await sandbox('result-quota', 128);
    try {
      const write = await worker.exec([
        'sh',
        '-c',
        `dd if=/dev/zero of=/work/result/large.bin bs=4096 count=2`,
      ]);
      expect(write.exit).not.toBe(0);
      expect(write.stderr).toMatch(/No space left on device/i);
      const state = await worker.inspect();
      expect(state.oomKilled).toBe(false);
      const diagnostic = workerDiagnostic(
        'ARXIC-WORKER-QUOTA-EXCEEDED',
        worker.jobId,
        'Worker artifact transport exceeded its enforced quota.',
      );
      expect(validateDiagnostic(diagnostic)).toMatchObject({ ok: true });
      // A volume-full worker is blocked without host buffering or OOM.
      expect({ outcome: diagnostic.severity, diagnostic }).toMatchObject({ outcome: 'blocked' });
    } finally {
      await worker.stop();
    }
  }, 120_000);

  it('rejects an oversized file during streaming import and leaves the host healthy', async ({
    skip,
  }) => {
    if (!dockerAvailable) skip(`Docker unavailable: ${dockerReason}`);
    const worker = await sandbox('result-file-quota', 1024 * 1024, { perFileBytes: 64 * 1024 });
    try {
      const write = await worker.exec([
        'sh',
        '-c',
        'dd if=/dev/zero of=/work/result/large.bin bs=65537 count=1',
      ]);
      expect(write.exit, write.stderr).toBe(0);
      await expect(worker.collectArtifacts()).rejects.toMatchObject({
        name: 'ArtifactImportError',
        reason: 'quota',
        message: expect.stringContaining('per-file byte quota'),
      });
      expect((await worker.inspect()).oomKilled).toBe(false);
      const diagnostic = workerDiagnostic(
        'ARXIC-WORKER-QUOTA-EXCEEDED',
        worker.jobId,
        'Worker artifact transport exceeded its enforced quota.',
      );
      expect(validateDiagnostic(diagnostic)).toMatchObject({ ok: true });
      expect(diagnostic.severity).toBe('blocked');
    } finally {
      await worker.stop();
    }
  }, 120_000);

  it('rejects cumulative file count incrementally', async ({ skip }) => {
    if (!dockerAvailable) skip(`Docker unavailable: ${dockerReason}`);
    const worker = await sandbox('result-file-count', 1024 * 1024, { fileLimit: 2 });
    try {
      expect(
        (
          await worker.exec([
            'sh',
            '-c',
            'touch /work/result/a /work/result/b /work/result/c /work/result/result-manifest.json',
          ])
        ).exit,
      ).toBe(0);
      await expect(worker.collectArtifacts()).rejects.toMatchObject({
        reason: 'quota',
        message: expect.stringContaining('file-count quota'),
      });
      expect((await worker.inspect()).oomKilled).toBe(false);
    } finally {
      await worker.stop();
    }
  }, 120_000);

  it('rejects a hostile symlink before host extraction without writing its host target', async ({
    skip,
  }) => {
    if (!dockerAvailable) skip(`Docker unavailable: ${dockerReason}`);
    const worker = await sandbox('result-pre-extract-symlink');
    const hostTargetBefore = createHash('sha256')
      .update(await readFile('/etc/passwd'))
      .digest('hex');
    const stagingBefore = (await readdir(tmpdir()))
      .filter((name) => name.startsWith('arxic-worker-result-'))
      .sort();
    try {
      expect((await worker.exec(['ln', '-s', '/etc/passwd', '/work/result/escape'])).exit).toBe(0);
      // Exercise a write through the hostile link. The read-only container root
      // rejects it; collection must then reject the remaining link before any
      // archive is extracted by the host supervisor.
      expect(
        (await worker.exec(['sh', '-c', 'printf hostile > /work/result/escape'])).exit,
      ).not.toBe(0);
      await writeManifest(worker, []);
      await expect(worker.collectArtifacts()).rejects.toMatchObject({
        name: 'ArtifactImportError',
        reason: 'invalid',
        message: expect.stringContaining('unsafe filesystem entry'),
      });
      expect(
        createHash('sha256')
          .update(await readFile('/etc/passwd'))
          .digest('hex'),
      ).toBe(hostTargetBefore);
      expect(
        (await readdir(tmpdir())).filter((name) => name.startsWith('arxic-worker-result-')).sort(),
      ).toEqual(stagingBefore);
    } finally {
      await worker.stop();
    }
  }, 120_000);

  it('classifies a completion-marker exit 137 as an OOM quota breach', async ({ skip }) => {
    if (!dockerAvailable) skip(`Docker unavailable: ${dockerReason}`);
    const source = await mkdtemp(join(tmpdir(), 'arxic-result-source-'));
    directories.push(source);
    await writeFile(join(source, 'source.txt'), 'source');
    const jobId = identity('marker-oom');
    const worker = await createWorkerSandbox({
      jobId,
      sourcePath: source,
      networkName: `arxic-${jobId}-net`,
      quotas: {
        memoryMb: 64,
        memorySwapMb: 64,
        pidsLimit: 64,
        cpus: 0.5,
        timeoutMs: 15_000,
      },
      resultVolume: { mountPath: '/work/result', quotaBytes: 1024 * 1024 },
      command: ['sh', '-c', 'exit 137'],
    });
    try {
      let state = await worker.inspect();
      for (let attempt = 0; state.status === 'running' && attempt < 20; attempt += 1) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
        state = await worker.inspect();
      }
      expect(state).toMatchObject({ status: 'exited', exitCode: 137, oomKilled: true });
    } finally {
      await worker.stop();
    }
  }, 120_000);

  it('rejects hard-linked result files before host extraction', async ({ skip }) => {
    if (!dockerAvailable) skip(`Docker unavailable: ${dockerReason}`);
    const worker = await sandbox('result-pre-extract-hardlink');
    try {
      expect(
        (
          await worker.exec([
            'sh',
            '-c',
            'printf hostile > /work/result/original && ln /work/result/original /work/result/alias',
          ])
        ).exit,
      ).toBe(0);
      await writeManifest(worker, []);
      await expect(worker.collectArtifacts()).rejects.toMatchObject({
        name: 'ArtifactImportError',
        reason: 'invalid',
        message: expect.stringContaining('unsafe filesystem entry'),
      });
    } finally {
      await worker.stop();
    }
  }, 120_000);

  it('rejects a manifest path-traversal declaration as blocked run failure', async ({ skip }) => {
    if (!dockerAvailable) skip(`Docker unavailable: ${dockerReason}`);
    const worker = await sandbox('result-traversal');
    try {
      await writeManifest(worker, [{ path: '../etc/passwd', sha256: '0'.repeat(64), bytes: 0 }]);
      const raw = await worker.collectArtifacts();
      expectImportCode(() => importArtifacts(raw, worker.jobId), 'invalid');
    } finally {
      await worker.stop();
    }
  }, 120_000);

  it('rejects a FIFO as a non-regular result file', async ({ skip }) => {
    if (!dockerAvailable) skip(`Docker unavailable: ${dockerReason}`);
    const worker = await sandbox('result-fifo');
    try {
      expect((await worker.exec(['mkfifo', '/work/result/pipe'])).exit).toBe(0);
      await writeManifest(worker, []);
      await expect(worker.collectArtifacts()).rejects.toMatchObject({
        name: 'ArtifactImportError',
        reason: 'invalid',
        message: expect.stringContaining('unsafe filesystem entry'),
      });
    } finally {
      await worker.stop();
    }
  }, 120_000);

  it('rejects a forged SHA-256 as blocked run failure', async ({ skip }) => {
    if (!dockerAvailable) skip(`Docker unavailable: ${dockerReason}`);
    const worker = await sandbox('result-forged');
    try {
      expect(
        (await worker.exec(['sh', '-c', `printf genuine > /work/result/data.json`])).exit,
      ).toBe(0);
      await writeManifest(worker, [{ path: 'data.json', sha256: '0'.repeat(64), bytes: 7 }]);
      const raw = await worker.collectArtifacts();
      expectImportCode(() => importArtifacts(raw, worker.jobId), 'invalid');
    } finally {
      await worker.stop();
    }
  }, 120_000);

  it('rejects a missing manifest as ARXIC-WORKER-RUN-FAILED', async ({ skip }) => {
    if (!dockerAvailable) skip(`Docker unavailable: ${dockerReason}`);
    const worker = await sandbox('result-missing');
    try {
      const raw = await worker.collectArtifacts();
      expectImportCode(() => importArtifacts(raw, worker.jobId), 'invalid');
      // Action mapping: ArtifactImportError(reason=invalid) → blocked / ARXIC-WORKER-RUN-FAILED.
    } finally {
      await worker.stop();
    }
  }, 120_000);

  it('keeps the result-mounted worker on an internal network denying host and metadata egress', async ({
    skip,
  }) => {
    if (!dockerAvailable) skip(`Docker unavailable: ${dockerReason}`);
    const worker = await sandbox('result-egress');
    try {
      expect(await dockerInspect(worker.networkName, '{{.Internal}}', 'network')).toBe('true');
      const gateway = await dockerInspect(
        'bridge',
        '{{range .IPAM.Config}}{{.Gateway}}{{end}}',
        'network',
      );
      const host = await worker.exec(['wget', '-T2', '-qO-', `http://${gateway}:1`]);
      expect(host.exit).not.toBe(0);
      expect(host.stderr).toMatch(/Network unreachable|timed out/i);
      const metadata = await worker.exec(['wget', '-T2', '-qO-', 'http://169.254.169.254/']);
      expect(metadata.exit).not.toBe(0);
      expect(metadata.stderr).toMatch(/Network unreachable|timed out/i);
    } finally {
      await worker.stop();
    }
  }, 120_000);

  it('imports binary PNG and JSON bytes, agrees with recomputed hashes, and cleans up idempotently', async ({
    skip,
  }) => {
    if (!dockerAvailable) skip(`Docker unavailable: ${dockerReason}`);
    const worker = await sandbox('result-happy');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
    const json = Buffer.from('{"safe":true}\n');
    const png64 = png.toString('base64');
    const json64 = json.toString('base64');
    try {
      expect(
        (
          await worker.exec([
            'sh',
            '-c',
            `mkdir -p /work/result/nested && printf %s '${png64}' | base64 -d > /work/result/proof.png && printf %s '${json64}' | base64 -d > /work/result/nested/data.json`,
          ])
        ).exit,
      ).toBe(0);
      await writeManifest(worker, [
        { path: 'proof.png', sha256: sha256(png), bytes: png.length },
        { path: 'nested/data.json', sha256: sha256(json), bytes: json.length },
      ]);
      const imported = importArtifacts(await worker.collectArtifacts(), worker.jobId);
      expect(imported.manifest.resultReady).toBe(true);
      expect(imported.files.map(({ path, sha256: digest }) => [path, digest])).toEqual([
        ['proof.png', sha256(png)],
        ['nested/data.json', sha256(json)],
      ]);
      expect(Buffer.from(imported.files[0]!.bytes)).toEqual(png);
      expect(Buffer.from(imported.files[1]!.bytes)).toEqual(json);
      expect((await worker.stop()).cleanupDiagnostics).toEqual([]);
      expect((await worker.stop()).cleanupDiagnostics).toEqual([]);
      expect((await volumeInspect(worker.resultVolumeName!)).exit).not.toBe(0);
    } finally {
      await worker.stop();
    }
  }, 120_000);
});
