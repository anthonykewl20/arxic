import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkerSandbox,
  dockerInspect,
  dockerVersion,
  volumeInspect,
  type WorkerSandbox,
} from '..';
import { ArtifactImportError, importArtifacts, type ArtifactTransportManifest } from '..';

const directories: string[] = [];
let dockerAvailable = false;
let dockerReason = '';

function identity(label: string): string {
  return `${label}-${process.pid}-${randomUUID().slice(0, 8)}`;
}

async function sandbox(label: string, quotaBytes = 256 * 1024 * 1024): Promise<WorkerSandbox> {
  const source = await mkdtemp(join(tmpdir(), 'arxic-result-source-'));
  directories.push(source);
  await writeFile(join(source, 'source.txt'), 'source');
  const jobId = identity(label);
  return createWorkerSandbox({
    jobId,
    sourcePath: source,
    networkName: `arxic-${jobId}-net`,
    quotas: { memoryMb: 64, memorySwapMb: 64, pidsLimit: 64, cpus: 0.5, timeoutMs: 15_000 },
    resultVolume: { mountPath: '/work/result', quotaBytes },
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

  it('blocks an over-quota volume import as ARXIC-WORKER-QUOTA-EXCEEDED', async ({ skip }) => {
    if (!dockerAvailable) skip(`Docker unavailable: ${dockerReason}`);
    const worker = await sandbox('result-quota', 128);
    try {
      const bytes = Buffer.alloc(256, 0x61);
      expect(
        (
          await worker.exec([
            'sh',
            '-c',
            `dd if=/dev/zero of=/work/result/large.bin bs=256 count=1`,
          ])
        ).exit,
      ).toBe(0);
      await writeManifest(worker, [
        { path: 'large.bin', sha256: sha256(bytes), bytes: bytes.length },
      ]);
      const raw = await worker.collectArtifacts();
      expectImportCode(() => importArtifacts(raw, worker.jobId, { quotaBytes: 128 }), 'quota');
      // Action mapping: ArtifactImportError(reason=quota) → blocked / ARXIC-WORKER-QUOTA-EXCEEDED.
    } finally {
      await worker.stop();
    }
  }, 120_000);

  it('rejects a symlink in the result volume as blocked run failure', async ({ skip }) => {
    if (!dockerAvailable) skip(`Docker unavailable: ${dockerReason}`);
    const worker = await sandbox('result-symlink');
    try {
      expect((await worker.exec(['ln', '-s', '/etc/passwd', '/work/result/link'])).exit).toBe(0);
      await writeManifest(worker, []);
      const raw = await worker.collectArtifacts();
      expectImportCode(() => importArtifacts(raw, worker.jobId), 'invalid');
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
      const raw = await worker.collectArtifacts();
      expectImportCode(() => importArtifacts(raw, worker.jobId), 'invalid');
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
