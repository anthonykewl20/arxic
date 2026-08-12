import { lstat, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import type { Diagnostic } from '@arxic/contracts';
import {
  dockerExec,
  dockerCp,
  dockerInspect,
  dockerKill,
  dockerRm,
  dockerRunDetach,
  dockerRun,
  networkCreate,
  networkRm,
  volumeCreate,
  volumeInspect,
  volumeRm,
  type DockerResult,
} from './docker-cli';
import { workerDiagnostic } from './worker-diagnostics';

/**
 * Non-root fallback used where the host exposes no POSIX uid (e.g. Windows,
 * where `process.getuid` is undefined). Keeps the worker non-root; on those
 * platforms bind-mount readability is mediated by the container runtime's file
 * sharing rather than by matching a host uid.
 */
const NON_ROOT_FALLBACK_USER = '1000:1000';

/**
 * Resolve the worker `--user` default to the host uid:gid so a bind-mounted
 * source stays readable for whoever actually owns it, while the container
 * remains non-root. On non-POSIX platforms (no `getuid`/`getgid`) falls back to
 * a conventional non-root uid:gid. If the host process runs as root this
 * resolves to `0:0`, which `assertSafeSpec` then rejects fail-closed.
 */
export function defaultWorkerUser(): string {
  const getuid = (process as { getuid?: () => number }).getuid;
  const getgid = (process as { getgid?: () => number }).getgid;
  if (typeof getuid !== 'function' || typeof getgid !== 'function') {
    return NON_ROOT_FALLBACK_USER;
  }
  return `${getuid.call(process)}:${getgid.call(process)}`;
}

export type WorkerQuotas = Readonly<{
  memoryMb: number;
  memorySwapMb: number;
  pidsLimit: number;
  cpus: number;
  timeoutMs: number;
}>;

export function defaultQuotas(maxRuntimeMinutes: number): WorkerQuotas {
  const minutes =
    Number.isFinite(maxRuntimeMinutes) && maxRuntimeMinutes > 0 ? maxRuntimeMinutes : 1;
  return Object.freeze({
    memoryMb: 512,
    memorySwapMb: 512,
    pidsLimit: 256,
    cpus: 1,
    timeoutMs: Math.ceil(minutes * 60_000),
  });
}

export type WorkerSandboxSpec = Readonly<{
  jobId: string;
  sourcePath: string;
  image?: string;
  quotas: WorkerQuotas;
  networkName: string;
  workerUser?: string;
  writableTmpFs?: string;
  resultVolume?: Readonly<{ mountPath: string; quotaBytes: number }>;
  env?: Record<string, string>;
}>;

export type SandboxExecResult = Readonly<{
  exit: number;
  stdout: string;
  stderr: string;
  oomKilled: boolean;
  timedOut: boolean;
}>;

export type SandboxState = Readonly<{ status: string; exitCode: number; oomKilled: boolean }>;

export type RawArtifactEntry = Readonly<{
  path: string;
  kind: 'regular' | 'directory' | 'symlink' | 'other';
  bytes?: Uint8Array;
}>;

export type RawArtifactSet = Readonly<{ entries: readonly RawArtifactEntry[] }>;

export type WorkerSandbox = Readonly<{
  jobId: string;
  networkName: string;
  containerId: string;
  resultVolumeName?: string;
  quotas: WorkerQuotas;
  exec: (command: readonly string[] | string) => Promise<SandboxExecResult>;
  inspect: () => Promise<SandboxState>;
  collectArtifacts: () => Promise<RawArtifactSet>;
  stop: () => Promise<{ cleanupDiagnostics: Diagnostic[] }>;
}>;

/**
 * A single `workerUser` component (the uid/user or the gid/group half of a
 * Docker `--user` value) denotes root when it is the `root` account by name, an
 * empty string, or any integer form Docker parses as 0. Verified against Docker
 * 29: `0`, `00`, `+0`, and `-0` all resolve to uid/gid 0, and an omitted half
 * (`1000:` → gid 0, `:`/`` → uid 0) also resolves to 0 — so each is rejected
 * here. Non-zero integers and other account names are allowed; name aliases
 * that merely resolve to uid/gid 0 (e.g. `toor`) cannot be detected without
 * resolving and are intentionally out of scope for pre-flight string validation.
 */
function denotesRootComponent(component: string): boolean {
  if (component === '' || /^root$/i.test(component)) return true;
  if (/^[+-]?\d+$/.test(component)) return Number.parseInt(component, 10) === 0;
  return false;
}

function assertSafeSpec(spec: WorkerSandboxSpec): void {
  if (!/^arxic-[A-Za-z0-9_.-]+$/.test(spec.networkName))
    throw new Error('Worker network name must be arxic-prefixed');
  if (!spec.jobId || !/^[A-Za-z0-9_.-]+$/.test(spec.jobId))
    throw new Error('Worker jobId contains unsafe characters');
  const requestedUser = spec.workerUser ?? defaultWorkerUser();
  // Docker `--user` is `<name|uid>[:<group|gid>]` (per the docker run
  // reference): at most a uid/user and an optional gid/group. The worker must
  // hold no privileged identity, so reject when any component denotes root —
  // uid 0 is root, and gid 0 is the root group, which on many images grants
  // write access to system paths. This makes caller-supplied forms such as
  // `1000:0`, `1000:00`, `1000:+0`, or `nobody:0` fail closed before any Docker
  // call. Supplementary groups come from `--group-add`, which this sandbox
  // never exposes.
  if (requestedUser.split(':').some((component) => denotesRootComponent(component))) {
    throw new Error(
      spec.workerUser != null
        ? 'Worker may not run as root or in the root group (uid 0 / gid 0)'
        : 'Worker may not run as root: the host process is running as root (uid 0), and the worker must remain non-root; run the host process as a non-root user or set workerUser explicitly',
    );
  }
  const writable = spec.writableTmpFs ?? '/work';
  if (!/^\/work(?:\/(?!source(?:\/|$))[A-Za-z0-9_.-]+)*$/.test(writable))
    throw new Error('Worker writable tmpfs must be scoped below /work and outside /work/source');
  if (spec.resultVolume) {
    const { mountPath, quotaBytes } = spec.resultVolume;
    if (
      !/^\/work\/(?!source(?:\/|$))[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(mountPath) ||
      mountPath === writable ||
      writable.startsWith(`${mountPath}/`)
    ) {
      throw new Error('Worker result volume must be below /work and outside /work/source/tmpfs');
    }
    if (!Number.isFinite(quotaBytes) || quotaBytes <= 0 || quotaBytes > 256 * 1024 * 1024) {
      throw new Error('Worker result volume quota must be positive and at most 256 MiB');
    }
  }
  const { memoryMb, memorySwapMb, pidsLimit, cpus, timeoutMs } = spec.quotas;
  if (
    ![memoryMb, memorySwapMb, pidsLimit, cpus, timeoutMs].every(
      (quota) => Number.isFinite(quota) && quota > 0,
    ) ||
    memorySwapMb < memoryMb
  )
    throw new Error('Worker quotas must be positive, finite, and memorySwapMb >= memoryMb');
  for (const [name] of Object.entries(spec.env ?? {})) {
    if (/^DOCKER_(HOST|CONTEXT|TLS.*|CERT_PATH)$/i.test(name))
      throw new Error(`Worker daemon environment is forbidden: ${name}`);
  }
}

function requireSuccess(operation: string, result: DockerResult): void {
  if (result.exit !== 0)
    throw new Error(`${operation} failed: ${result.stderr || `exit ${result.exit}`}`);
}

export async function createWorkerSandbox(spec: WorkerSandboxSpec): Promise<WorkerSandbox> {
  assertSafeSpec(spec);
  const containerName = `arxic-${spec.jobId}-worker`;
  const image = spec.image ?? 'node:20-alpine';
  const user = spec.workerUser ?? defaultWorkerUser();
  const writable = spec.writableTmpFs ?? '/work';
  const source = resolve(spec.sourcePath);
  const resultVolumeName = spec.resultVolume ? `arxic-${spec.jobId}-result` : undefined;
  let networkCreated = false;
  let volumeCreated = false;
  try {
    if (resultVolumeName) {
      const existing = await volumeInspect(resultVolumeName);
      if (existing.exit === 0) {
        throw new Error('Worker result volume already exists; refusing to reuse untrusted bytes');
      }
      const volume = await volumeCreate({ name: resultVolumeName });
      requireSuccess('docker volume create', volume);
      volumeCreated = true;
      // Named volumes have no portable native byte quota. Make the empty,
      // per-run volume writable here; quotaBytes is enforced fail-closed by the
      // trusted importer before any artifact is accepted.
      const prepared = await dockerRun([
        '--rm',
        '--network',
        'none',
        '--mount',
        `type=volume,source=${resultVolumeName},destination=/result`,
        'node:20-alpine',
        'chmod',
        '1777',
        '/result',
      ]);
      requireSuccess('prepare worker result volume', prepared);
    }
    const network = await networkCreate({ name: spec.networkName, internal: true });
    requireSuccess('docker network create', network);
    networkCreated = true;
    const run = await dockerRunDetach([
      '--name',
      containerName,
      '--user',
      user,
      '--read-only',
      '--security-opt',
      'no-new-privileges:true',
      '--cap-drop',
      'ALL',
      '--tmpfs',
      `${writable}:rw,size=8m,mode=1777`,
      '--mount',
      `type=bind,source=${source},target=/work/source,readonly`,
      ...(resultVolumeName && spec.resultVolume
        ? [
            '--mount',
            `type=volume,source=${resultVolumeName},destination=${spec.resultVolume.mountPath}`,
          ]
        : []),
      '--memory',
      `${spec.quotas.memoryMb}m`,
      '--memory-swap',
      `${spec.quotas.memorySwapMb}m`,
      '--pids-limit',
      String(spec.quotas.pidsLimit),
      '--cpus',
      String(spec.quotas.cpus),
      '--network',
      spec.networkName,
      ...Object.entries(spec.env ?? {}).flatMap(([name, value]) => ['--env', `${name}=${value}`]),
      image,
      'node',
      '-e',
      'setInterval(()=>{},60000)',
    ]);
    requireSuccess('docker run', run);
    const containerId = run.stdout;
    let stopped = false;
    const sandbox = {} as WorkerSandbox;
    const stop = async (): Promise<{ cleanupDiagnostics: Diagnostic[] }> => {
      if (stopped) return { cleanupDiagnostics: [] };
      const cleanupDiagnostics: Diagnostic[] = [];
      const removed = await dockerRm(containerId || containerName);
      if (removed.exit !== 0) {
        cleanupDiagnostics.push(
          workerDiagnostic(
            'ARXIC-WORKER-CLEANUP-FAILED',
            spec.jobId,
            `Could not remove worker container: ${removed.stderr}`,
          ),
        );
      }
      const networkRemoved = await networkRm(spec.networkName);
      if (networkRemoved.exit !== 0) {
        cleanupDiagnostics.push(
          workerDiagnostic(
            'ARXIC-WORKER-CLEANUP-FAILED',
            spec.jobId,
            `Could not remove worker network: ${networkRemoved.stderr}`,
          ),
        );
      }
      if (resultVolumeName) {
        const volumeRemoved = await volumeRm(resultVolumeName);
        if (volumeRemoved.exit !== 0) {
          cleanupDiagnostics.push(
            workerDiagnostic(
              'ARXIC-WORKER-CLEANUP-FAILED',
              spec.jobId,
              `Could not remove worker result volume: ${volumeRemoved.stderr}`,
            ),
          );
        }
      }
      if (cleanupDiagnostics.length === 0) stopped = true;
      return { cleanupDiagnostics };
    };
    Object.assign(sandbox, {
      jobId: spec.jobId,
      networkName: spec.networkName,
      containerId,
      resultVolumeName,
      quotas: spec.quotas,
      exec: (command: readonly string[] | string) => execInSandbox(sandbox, command),
      inspect: () => inspectSandbox(sandbox),
      collectArtifacts: () =>
        spec.resultVolume
          ? collectRawArtifacts(containerId, spec.resultVolume.mountPath)
          : Promise.resolve({ entries: [] }),
      stop,
    });
    return Object.freeze(sandbox);
  } catch (error) {
    const containerCleanup = await dockerRm(containerName);
    const networkCleanup = networkCreated
      ? await networkRm(spec.networkName)
      : { exit: 0, stdout: '', stderr: '' };
    const volumeCleanup =
      volumeCreated && resultVolumeName
        ? await volumeRm(resultVolumeName)
        : { exit: 0, stdout: '', stderr: '' };
    if (containerCleanup.exit !== 0 || networkCleanup.exit !== 0 || volumeCleanup.exit !== 0) {
      throw new Error(
        `Worker creation failed and cleanup was incomplete: ${containerCleanup.stderr} ${networkCleanup.stderr} ${volumeCleanup.stderr}`.trim(),
        { cause: error },
      );
    }
    throw error;
  }
}

async function collectRawArtifacts(
  containerId: string,
  mountPath: string,
): Promise<RawArtifactSet> {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-worker-result-'));
  try {
    const copied = await dockerCp(containerId, `${mountPath}/.`, directory);
    requireSuccess('docker cp worker result volume', copied);
    const entries: RawArtifactEntry[] = [];
    await readRawEntries(directory, directory, entries);
    entries.sort((left, right) => left.path.localeCompare(right.path));
    return { entries };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function readRawEntries(
  root: string,
  directory: string,
  output: RawArtifactEntry[],
): Promise<void> {
  for (const name of await readdir(directory)) {
    const absolute = join(directory, name);
    const path = relative(root, absolute).split(sep).join('/');
    const stat = await lstat(absolute);
    if (output.length >= 4098) {
      throw new Error('Worker result contains too many filesystem entries');
    }
    if (stat.isSymbolicLink()) {
      output.push({ path, kind: 'symlink' });
    } else if (stat.isDirectory()) {
      output.push({ path, kind: 'directory' });
      await readRawEntries(root, absolute, output);
    } else if (stat.isFile()) {
      output.push({ path, kind: 'regular', bytes: await readFile(absolute) });
    } else {
      output.push({ path, kind: 'other' });
    }
  }
}

export async function inspectSandbox(sandbox: WorkerSandbox): Promise<SandboxState> {
  const raw = await dockerInspect(
    sandbox.containerId,
    '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}}',
  );
  const [status = 'unknown', exitCode = '-1', oomKilled = 'false'] = raw.split(/\s+/);
  return { status, exitCode: Number(exitCode), oomKilled: oomKilled === 'true' };
}

export async function execInSandbox(
  sandbox: WorkerSandbox,
  command: readonly string[] | string,
): Promise<SandboxExecResult> {
  const args = typeof command === 'string' ? ['sh', '-c', command] : command;
  const result = await dockerExec(sandbox.containerId, args, {
    timeoutMs: sandbox.quotas.timeoutMs,
  });
  const timedOut = result.exit === 124;
  if (timedOut) await dockerKill(sandbox.containerId);
  // The container-state OOMKilled flag is the authority for memory-quota
  // breach; a bare exit 137 is only a fallback signal when the container
  // disappeared before it could be inspected.
  let oomKilled = false;
  try {
    oomKilled = (await inspectSandbox(sandbox)).oomKilled;
  } catch {
    oomKilled = result.exit === 137;
  }
  if (oomKilled) {
    // An OOM during `docker exec` can leave the keepalive PID running. The
    // supervisor must terminate that surviving process tree so quota failure
    // is represented by a stopped worker, not a reusable partial sandbox.
    await dockerKill(sandbox.containerId);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        if ((await inspectSandbox(sandbox)).status !== 'running') break;
      } catch {
        break;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    }
  }
  return { ...result, oomKilled, timedOut };
}
