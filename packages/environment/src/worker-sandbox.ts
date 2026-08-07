import { resolve } from 'node:path';
import type { Diagnostic } from '@arxic/contracts';
import {
  dockerExec,
  dockerInspect,
  dockerKill,
  dockerRm,
  dockerRunDetach,
  networkCreate,
  networkRm,
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

export type WorkerSandbox = Readonly<{
  jobId: string;
  networkName: string;
  containerId: string;
  quotas: WorkerQuotas;
  exec: (command: readonly string[] | string) => Promise<SandboxExecResult>;
  inspect: () => Promise<SandboxState>;
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
  let networkCreated = false;
  try {
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
      if (cleanupDiagnostics.length === 0) stopped = true;
      return { cleanupDiagnostics };
    };
    Object.assign(sandbox, {
      jobId: spec.jobId,
      networkName: spec.networkName,
      containerId,
      quotas: spec.quotas,
      exec: (command: readonly string[] | string) => execInSandbox(sandbox, command),
      inspect: () => inspectSandbox(sandbox),
      stop,
    });
    return Object.freeze(sandbox);
  } catch (error) {
    const containerCleanup = await dockerRm(containerName);
    const networkCleanup = networkCreated
      ? await networkRm(spec.networkName)
      : { exit: 0, stdout: '', stderr: '' };
    if (containerCleanup.exit !== 0 || networkCleanup.exit !== 0) {
      throw new Error(
        `Worker creation failed and cleanup was incomplete: ${containerCleanup.stderr} ${networkCleanup.stderr}`.trim(),
        { cause: error },
      );
    }
    throw error;
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
