import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkerSandbox,
  defaultWorkerUser,
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
  // mkdtemp creates a host-owned 0700 directory; the worker default user now
  // mirrors the host uid:gid (defaultWorkerUser), so the container can traverse
  // and read it without any chmod relaxation. This is the real-world fixture
  // condition the sandbox must handle.
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
      expect(await execInSandbox(sandbox, ['id', '-u'])).toMatchObject({
        exit: 0,
        stdout: String(process.getuid!()),
      });
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
      expect(rootWrite.stderr).toMatch(/read-only file system/i);
      const sourceWrite = await execInSandbox(sandbox, [
        'sh',
        '-c',
        'printf no > /work/source/proof',
      ]);
      expect(sourceWrite.exit).not.toBe(0);
      expect(sourceWrite.stderr).toMatch(/read-only file system/i);
      expect(await execInSandbox(sandbox, ['cat', '/work/source/source.txt'])).toMatchObject({
        exit: 0,
        stdout: 'mounted',
      });
    } finally {
      await sandbox.stop();
    }
  }, 120_000);

  it('reads a host-private (0700) source directory under the host-uid default', async ({
    skip,
  }) => {
    if (!dockerAvailable) skip(`Docker unavailable: ${dockerReason}`);
    if (typeof process.getuid !== 'function') skip('POSIX-only uid semantics');
    const jobId = identity('uid-default');
    // Deliberately host-private: mkdtemp default is 0700 owned by the host uid,
    // the file is 0600. No chmod relaxation. Under the old hardcoded 1000:1000
    // default this read fails on any host whose uid != 1000 (the CI condition);
    // under the host-uid default the container owns the mount and reads it.
    const directory = await mkdtemp(join(tmpdir(), 'arxic-m112-uid-'));
    directories.push(directory);
    await writeFile(join(directory, 'private.txt'), 'host-owned', { mode: 0o600 });
    const sandbox = await createWorkerSandbox({
      jobId,
      sourcePath: directory,
      quotas,
      networkName: `arxic-${jobId}-net`,
      // workerUser intentionally omitted: the default must mirror the host uid.
    });
    try {
      expect(await execInSandbox(sandbox, ['id', '-u'])).toMatchObject({
        exit: 0,
        stdout: String(process.getuid!()),
      });
      expect(await execInSandbox(sandbox, ['id', '-g'])).toMatchObject({
        exit: 0,
        stdout: String(process.getgid!()),
      });
      expect(await execInSandbox(sandbox, ['cat', '/work/source/private.txt'])).toMatchObject({
        exit: 0,
        stdout: 'host-owned',
      });
    } finally {
      await sandbox.stop();
    }
  }, 120_000);

  it('accepts a caller-supplied non-root workerUser and runs as that identity', async ({
    skip,
  }) => {
    if (!dockerAvailable) skip(`Docker unavailable: ${dockerReason}`);
    if (typeof process.getuid !== 'function') skip('POSIX-only uid semantics');
    const jobId = identity('explicit-user');
    const source = await sourceFile('source.txt', 'ok');
    // An explicitly-supplied, non-root workerUser must be accepted — not
    // over-rejected — and the container must run as exactly that uid:gid. This
    // pins the allow-side of the root-group rejection so a future widening of
    // denotesRootComponent (e.g. to reject empty components) cannot silently
    // break legitimate non-root callers.
    const sandbox = await createWorkerSandbox({
      jobId,
      sourcePath: source,
      quotas,
      networkName: `arxic-${jobId}-net`,
      workerUser: `${process.getuid!()}:${process.getgid!()}`,
    });
    try {
      expect(await execInSandbox(sandbox, ['id', '-u'])).toMatchObject({
        exit: 0,
        stdout: String(process.getuid!()),
      });
      expect(await execInSandbox(sandbox, ['id', '-g'])).toMatchObject({
        exit: 0,
        stdout: String(process.getgid!()),
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
    [
      'result volume overlaps source',
      {
        ...base,
        jobId: 'safe',
        networkName: 'arxic-safe-net',
        resultVolume: { mountPath: '/work/source/result', quotaBytes: 1024 },
      },
    ],
    [
      'result volume escapes work',
      {
        ...base,
        jobId: 'safe',
        networkName: 'arxic-safe-net',
        resultVolume: { mountPath: '/result', quotaBytes: 1024 },
      },
    ],
    [
      'result volume quota exceeds 256 MiB',
      {
        ...base,
        jobId: 'safe',
        networkName: 'arxic-safe-net',
        resultVolume: { mountPath: '/work/result', quotaBytes: 256 * 1024 * 1024 + 1 },
      },
    ],
  ])('rejects an unsafe sandbox spec before touching Docker: %s', async (_name, spec) => {
    await expect(createWorkerSandbox(spec)).rejects.toThrow();
  });

  // The worker must hold no privileged identity: uid 0 is root and gid 0 is the
  // root group, which on many images grants write access to system paths. The
  // rejection runs inside assertSafeSpec, before any Docker call, and must cover
  // the root-GROUP form (e.g. 1000:0) that a pre-fix regex anchored only on the
  // uid component let through. The matcher pins the safety message so a Docker
  // collision/timeout cannot mask a regression as a false pass.
  it.each([
    ['root group on a non-root uid', '1000:0'],
    ['root group by name on a non-root uid', '1000:root'],
    ['uppercase ROOT group on a non-root uid', '1000:ROOT'],
    ['root group via leading-zero gid', '1000:00'],
    ['root group via signed-zero gid', '1000:+0'],
    ['empty gid component (Docker maps to gid 0)', '1000:'],
    ['empty uid and gid (Docker maps to uid 0)', ':'],
    ['empty workerUser (Docker maps to uid 0)', ''],
    ['root uid via leading-zero uid', '00:1000'],
    ['root group on a named user', 'nobody:0'],
    ['root uid alone', '0'],
    ['root user by name', 'root'],
    ['root uid and root group', '0:0'],
    ['root uid with a non-root gid', '0:1000'],
  ])(
    'rejects a caller-supplied workerUser holding root uid or root group before Docker: %s',
    async (_name, workerUser) => {
      await expect(
        createWorkerSandbox({
          ...base,
          jobId: 'safe',
          networkName: 'arxic-safe-net',
          workerUser,
        }),
      ).rejects.toThrow(/may not run as root/i);
    },
  );
});

describe('defaultWorkerUser resolves a non-root default', () => {
  it('mirrors the host uid:gid on POSIX', () => {
    if (typeof process.getuid !== 'function') return; // non-POSIX host
    expect(defaultWorkerUser()).toBe(`${process.getuid()}:${process.getgid!()}`);
  });

  it('never resolves to root when the host process is non-root', () => {
    if (typeof process.getuid !== 'function') return;
    if (process.getuid() === 0) return; // host is root; root rejection is assertSafeSpec's job
    expect(/^(?:root|0)(?::|$)/i.test(defaultWorkerUser())).toBe(false);
  });

  it('falls back to a non-root default when getuid/getgid are unavailable (non-POSIX)', () => {
    const ownGetuid = Object.getOwnPropertyDescriptor(process, 'getuid');
    const ownGetgid = Object.getOwnPropertyDescriptor(process, 'getgid');
    try {
      // Shadow the POSIX accessors to simulate a non-POSIX host (Windows), where
      // process.getuid/getgid do not exist.
      Object.defineProperty(process, 'getuid', { value: undefined, configurable: true });
      Object.defineProperty(process, 'getgid', { value: undefined, configurable: true });
      const fallback = defaultWorkerUser();
      expect(fallback).toBe('1000:1000');
      expect(/^(?:root|0)(?::|$)/i.test(fallback)).toBe(false);
    } finally {
      if (ownGetuid) Object.defineProperty(process, 'getuid', ownGetuid);
      else delete (process as { getuid?: unknown }).getuid;
      if (ownGetgid) Object.defineProperty(process, 'getgid', ownGetgid);
      else delete (process as { getgid?: unknown }).getgid;
    }
  });
});
