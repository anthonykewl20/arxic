import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkerSandbox,
  dockerInspect,
  dockerRm,
  dockerRunDetach,
  dockerVersion,
  execInSandbox,
  inspectSandbox,
  networkConnect,
  type WorkerQuotas,
  type WorkerSandbox,
} from '..';

const directories: string[] = [];
let dockerAvailable = false;
let dockerReason = '';
const quotas: WorkerQuotas = {
  memoryMb: 64,
  memorySwapMb: 64,
  pidsLimit: 64,
  cpus: 0.5,
  timeoutMs: 15_000,
};

function identity(label: string): string {
  return `${label}-${process.pid}-${randomUUID().slice(0, 8)}`;
}

async function sourceFile(name: string, contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-m112-'));
  directories.push(directory);
  await writeFile(join(directory, name), contents);
  // The worker runs as uid 1000; on CI the runner uid differs, so the default
  // 0700 mkdtemp dir would be unreadable by the container. Make the source dir
  // traversable (0755) and the file readable (0644) by any uid.
  await chmod(directory, 0o755);
  await chmod(join(directory, name), 0o644);
  return directory;
}

describe('real Docker worker sandbox', () => {
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

  it('denies cross-job source and host-path reads', async ({ skip }) => {
    if (!dockerAvailable) skip(`Docker unavailable: ${dockerReason}`);
    const a = identity('cross-a');
    const b = identity('cross-b');
    const sourceA = await sourceFile('secret-A.txt', 'alpha');
    const sourceB = await sourceFile('secret-B.txt', 'bravo');
    const sandboxA = await createWorkerSandbox({
      jobId: a,
      sourcePath: sourceA,
      quotas,
      networkName: `arxic-${a}-net`,
    });
    let sandboxB: WorkerSandbox | undefined;
    try {
      sandboxB = await createWorkerSandbox({
        jobId: b,
        sourcePath: sourceB,
        quotas,
        networkName: `arxic-${b}-net`,
      });
      expect(await execInSandbox(sandboxA, ['cat', '/work/source/secret-A.txt'])).toMatchObject({
        exit: 0,
        stdout: 'alpha',
      });
      const missingMount = await execInSandbox(sandboxA, ['cat', '/work/source/secret-B.txt']);
      expect(missingMount.exit).not.toBe(0);
      expect(missingMount.stderr).toMatch(/No such file/i);
      const hostPath = await execInSandbox(sandboxA, ['cat', join(sourceB, 'secret-B.txt')]);
      expect(hostPath.exit).not.toBe(0);
      expect(hostPath.stderr).toMatch(/No such file/i);
    } finally {
      await Promise.all([sandboxA.stop(), sandboxB?.stop()]);
    }
  }, 120_000);

  it('allows a declared sibling but denies host-gateway and metadata egress', async ({ skip }) => {
    if (!dockerAvailable) skip(`Docker unavailable: ${dockerReason}`);
    const jobId = identity('egress');
    const sibling = `arxic-${jobId}-sib`;
    const source = await sourceFile('source.txt', 'ok');
    const sandbox = await createWorkerSandbox({
      jobId,
      sourcePath: source,
      quotas,
      networkName: `arxic-${jobId}-net`,
    });
    try {
      const siblingRun = await dockerRunDetach([
        '--name',
        sibling,
        'node:20-alpine',
        'node',
        '-e',
        "require('http').createServer((q,s)=>s.end('ok')).listen(8080)",
      ]);
      expect(siblingRun.exit, siblingRun.stderr).toBe(0);
      const connected = await networkConnect(sandbox.networkName, sibling, [sibling]);
      expect(connected.exit, connected.stderr).toBe(0);
      let allowed = await execInSandbox(sandbox, [
        'wget',
        '-T2',
        '-qO-',
        `http://${sibling}:8080/`,
      ]);
      for (let attempt = 0; allowed.exit !== 0 && attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        allowed = await execInSandbox(sandbox, ['wget', '-T2', '-qO-', `http://${sibling}:8080/`]);
      }
      expect(allowed).toMatchObject({ exit: 0, stdout: 'ok' });
      const gateway = await dockerInspect(
        'bridge',
        '{{range .IPAM.Config}}{{.Gateway}}{{end}}',
        'network',
      );
      const host = await execInSandbox(sandbox, ['wget', '-T2', '-qO-', `http://${gateway}:1`]);
      expect(host.exit).not.toBe(0);
      expect(host.stderr).toMatch(/Network unreachable|timed out/i);
      const metadata = await execInSandbox(sandbox, [
        'wget',
        '-T2',
        '-qO-',
        'http://169.254.169.254/',
      ]);
      expect(metadata.exit).not.toBe(0);
      expect(metadata.stderr).toMatch(/Network unreachable|timed out/i);
    } finally {
      await dockerRm(sibling);
      await sandbox.stop();
    }
  }, 120_000);

  it('terminates a memory quota breach with OOMKilled and exit 137', async ({ skip }) => {
    if (!dockerAvailable) skip(`Docker unavailable: ${dockerReason}`);
    const jobId = identity('oom');
    const source = await sourceFile('source.txt', 'ok');
    const sandbox = await createWorkerSandbox({
      jobId,
      sourcePath: source,
      networkName: `arxic-${jobId}-net`,
      quotas: { ...quotas, memoryMb: 16, memorySwapMb: 16, timeoutMs: 30_000 },
    });
    try {
      const result = await execInSandbox(sandbox, [
        'node',
        '-e',
        'const a=[];while(true)a.push(Buffer.alloc(1<<20))',
      ]);
      const state = await inspectSandbox(sandbox);
      expect(result.exit).not.toBe(0);
      expect(state).toMatchObject({ oomKilled: true, exitCode: 137 });
    } finally {
      await sandbox.stop();
    }
  }, 120_000);

  it('enforces non-root, read-only rootfs, writable tmpfs, and readable source', async ({
    skip,
  }) => {
    if (!dockerAvailable) skip(`Docker unavailable: ${dockerReason}`);
    const jobId = identity('filesystem');
    const source = await sourceFile('source.txt', 'mounted');
    const sandbox = await createWorkerSandbox({
      jobId,
      sourcePath: source,
      quotas,
      networkName: `arxic-${jobId}-net`,
    });
    try {
      expect(await execInSandbox(sandbox, ['id', '-u'])).toMatchObject({ exit: 0, stdout: '1000' });
      const daemonAccess = await execInSandbox(sandbox, [
        'sh',
        '-c',
        'test ! -e /var/run/docker.sock && test -z "$DOCKER_HOST$DOCKER_CONTEXT$DOCKER_TLS_VERIFY$DOCKER_CERT_PATH" && ! command -v docker',
      ]);
      expect(daemonAccess.exit).toBe(0);
      expect((await execInSandbox(sandbox, ['sh', '-c', 'printf ok > /work/out.txt'])).exit).toBe(
        0,
      );
      const rootWrite = await execInSandbox(sandbox, ['sh', '-c', 'printf no > /etc/foo']);
      expect(rootWrite.exit).not.toBe(0);
      expect(rootWrite.stderr).toMatch(/read-only file system|can't create|permission denied/i);
      const sourceWrite = await execInSandbox(sandbox, [
        'sh',
        '-c',
        'printf no > /work/source/proof',
      ]);
      expect(sourceWrite.exit).not.toBe(0);
      expect(sourceWrite.stderr).toMatch(/read-only file system|can't create|permission denied/i);
      expect(await execInSandbox(sandbox, ['cat', '/work/source/source.txt'])).toMatchObject({
        exit: 0,
        stdout: 'mounted',
      });
    } finally {
      await sandbox.stop();
    }
  }, 120_000);

  it('isolates job networks: a worker cannot reach another job sibling', async ({ skip }) => {
    if (!dockerAvailable) skip(`Docker unavailable: ${dockerReason}`);
    const jobA = identity('net-a');
    const jobB = identity('net-b');
    const sibling = `arxic-${jobA}-sib`;
    const sourceA = await sourceFile('source.txt', 'a');
    const sourceB = await sourceFile('source.txt', 'b');
    const sandboxA = await createWorkerSandbox({
      jobId: jobA,
      sourcePath: sourceA,
      quotas,
      networkName: `arxic-${jobA}-net`,
    });
    let sandboxB: WorkerSandbox | undefined;
    try {
      sandboxB = await createWorkerSandbox({
        jobId: jobB,
        sourcePath: sourceB,
        quotas,
        networkName: `arxic-${jobB}-net`,
      });
      const siblingRun = await dockerRunDetach([
        '--name',
        sibling,
        '--network',
        `arxic-${jobA}-net`,
        'node:20-alpine',
        'node',
        '-e',
        "require('http').createServer((q,s)=>s.end('a')).listen(8080)",
      ]);
      expect(siblingRun.exit, siblingRun.stderr).toBe(0);
      // job B's worker cannot resolve/reach job A's sibling (separate networks).
      const probe = await execInSandbox(sandboxB, [
        'wget',
        '-T2',
        '-qO-',
        `http://${sibling}:8080/`,
      ]);
      expect(probe.exit).not.toBe(0);
    } finally {
      await dockerRm(sibling);
      await Promise.all([sandboxA.stop(), sandboxB?.stop()]);
    }
  }, 120_000);

  it('removes the worker and network, and stop is idempotent', async ({ skip }) => {
    if (!dockerAvailable) skip(`Docker unavailable: ${dockerReason}`);
    const jobId = identity('cleanup');
    const source = await sourceFile('source.txt', 'ok');
    const sandbox = await createWorkerSandbox({
      jobId,
      sourcePath: source,
      quotas,
      networkName: `arxic-${jobId}-net`,
    });
    try {
      expect((await sandbox.stop()).cleanupDiagnostics).toEqual([]);
      expect((await sandbox.stop()).cleanupDiagnostics).toEqual([]);
      await expect(dockerInspect(sandbox.containerId, '{{.Id}}')).rejects.toThrow();
      await expect(dockerInspect(sandbox.networkName, '{{.Id}}', 'network')).rejects.toThrow();
    } finally {
      await sandbox.stop();
    }
  }, 120_000);
});

describe('worker sandbox construction is enforced safe', () => {
  const quotas: WorkerQuotas = {
    memoryMb: 64,
    memorySwapMb: 64,
    pidsLimit: 64,
    cpus: 0.5,
    timeoutMs: 15_000,
  };
  const base = { sourcePath: '/tmp', quotas };

  it.each([
    ['root user', { ...base, jobId: 'safe', networkName: 'arxic-safe-net', workerUser: '0:0' }],
    ['non-arxic network', { ...base, jobId: 'safe', networkName: 'evil-net' }],
    ['unsafe jobId', { ...base, jobId: 'rm -rf /', networkName: 'arxic-safe-net' }],
    [
      'daemon env',
      { ...base, jobId: 'safe', networkName: 'arxic-safe-net', env: { DOCKER_HOST: 'x' } },
    ],
    [
      'writable tmpfs under source',
      { ...base, jobId: 'safe', networkName: 'arxic-safe-net', writableTmpFs: '/work/source' },
    ],
    [
      'non-positive quota',
      { ...base, jobId: 'safe', networkName: 'arxic-safe-net', quotas: { ...quotas, memoryMb: 0 } },
    ],
  ])('rejects an unsafe sandbox spec before touching Docker: %s', async (_name, spec) => {
    await expect(createWorkerSandbox(spec)).rejects.toThrow();
  });
});
