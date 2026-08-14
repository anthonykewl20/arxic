import { createWriteStream } from 'node:fs';
import { lstat, mkdtemp, readdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Diagnostic } from '@arxic/contracts';
import {
  dockerExec,
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
import {
  ArtifactImportError,
  DEFAULT_RESULT_FILE_LIMIT,
  DEFAULT_RESULT_FILE_QUOTA_BYTES,
  readArtifactWithinQuota,
  type ArtifactReadBudget,
} from './artifact-quota';
import { validateTarArchive } from './tar-archive-validation';

/**
 * Non-root fallback used where the host exposes no POSIX uid (e.g. Windows,
 * where `process.getuid` is undefined). Keeps the worker non-root; on those
 * platforms bind-mount readability is mediated by the container runtime's file
 * sharing rather than by matching a host uid.
 */
const NON_ROOT_FALLBACK_USER = '1000:1000';
const RESULT_EXPORT_PATH = '/work/.arxic-result-export';
const RESULT_COMPLETE_MARKER = '.arxic-command-complete';

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

/** Quotas sized for a real in-sandbox Crawlee and Chromium pipeline. */
export function defaultQuotas(maxRuntimeMinutes: number): WorkerQuotas {
  const minutes =
    Number.isFinite(maxRuntimeMinutes) && maxRuntimeMinutes > 0 ? maxRuntimeMinutes : 1;
  return Object.freeze({
    memoryMb: 2048,
    memorySwapMb: 2048,
    pidsLimit: 256,
    cpus: 1,
    timeoutMs: Math.ceil(minutes * 60_000),
  });
}

/**
 * Sandbox launch configuration. The internal network may be pre-created so
 * trusted supervisors can attach sibling containers before the worker joins.
 * `command` overrides the default keepalive; when set, the container is
 * expected to run to completion and exit while the supervisor polls
 * `inspect()`.
 */
export type WorkerSandboxSpec = Readonly<{
  jobId: string;
  sourcePath: string;
  image?: string;
  quotas: WorkerQuotas;
  networkName: string;
  workerUser?: string;
  writableTmpFs?: string;
  resultVolume?: Readonly<{
    mountPath: string;
    quotaBytes: number;
    perFileBytes?: number;
    fileLimit?: number;
  }>;
  env?: Record<string, string>;
  command?: readonly string[];
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
  networkOwned: boolean;
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
    const perFileBytes =
      spec.resultVolume.perFileBytes ?? Math.min(DEFAULT_RESULT_FILE_QUOTA_BYTES, quotaBytes);
    const fileLimit = spec.resultVolume.fileLimit ?? DEFAULT_RESULT_FILE_LIMIT;
    if (
      !Number.isSafeInteger(perFileBytes) ||
      perFileBytes <= 0 ||
      perFileBytes > DEFAULT_RESULT_FILE_QUOTA_BYTES ||
      !Number.isSafeInteger(fileLimit) ||
      fileLimit <= 0 ||
      fileLimit > DEFAULT_RESULT_FILE_LIMIT
    ) {
      throw new Error('Worker result per-file bytes/file-count quotas are invalid');
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
      // The named volume is a lifecycle marker only. Result bytes are mounted
      // on the container's quota-sized tmpfs below; unlike a local named-volume
      // directory, tmpfs gives the hostile writer a physical ENOSPC boundary.
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
      requireSuccess('prepare worker result export volume', prepared);
    }
    const network = await networkCreate({ name: spec.networkName, internal: true });
    const networkAlreadyExists = network.exit !== 0 && /already exists/i.test(network.stderr);
    if (!networkAlreadyExists) requireSuccess('docker network create', network);
    networkCreated = network.exit === 0;
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
      `${writable}:rw,size=512m,mode=1777`,
      '--mount',
      `type=bind,source=${source},target=/work/source,readonly`,
      ...(resultVolumeName && spec.resultVolume
        ? [
            '--tmpfs',
            `${spec.resultVolume.mountPath}:rw,size=${spec.resultVolume.quotaBytes},mode=1777`,
            '--mount',
            `type=volume,source=${resultVolumeName},destination=${RESULT_EXPORT_PATH}`,
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
      ...(spec.resultVolume && spec.command
        ? [
            'sh',
            '-c',
            `result=$1; control=$2; shift 2; "$@"; status=$?; printf %s "$status" > "$control/${RESULT_COMPLETE_MARKER}"; while :; do sleep 60; done`,
            'arxic-result-wrapper',
            spec.resultVolume.mountPath,
            RESULT_EXPORT_PATH,
            ...spec.command,
          ]
        : (spec.command ?? ['node', '-e', 'setInterval(()=>{},60000)'])),
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
      if (sandbox.networkOwned) {
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
      networkOwned: networkCreated,
      containerId,
      resultVolumeName,
      quotas: spec.quotas,
      exec: (command: readonly string[] | string) => execInSandbox(sandbox, command),
      inspect: () => inspectSandbox(sandbox),
      collectArtifacts: () =>
        spec.resultVolume
          ? collectRawArtifacts(
              containerId,
              spec.resultVolume.mountPath,
              spec.resultVolume.quotaBytes,
              spec.resultVolume.perFileBytes ??
                Math.min(DEFAULT_RESULT_FILE_QUOTA_BYTES, spec.resultVolume.quotaBytes),
              spec.resultVolume.fileLimit ?? DEFAULT_RESULT_FILE_LIMIT,
            )
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
  quotaBytes: number,
  perFileBytes: number,
  fileLimit: number,
): Promise<RawArtifactSet> {
  const state = await dockerInspect(containerId, '{{.State.Status}}');
  const running = state === 'running';
  if (!running) throw new ArtifactImportError('invalid', 'Worker result tmpfs is unavailable');
  await assertResultVolumeCapacity(containerId, mountPath, quotaBytes);
  await assertResultTreeSafeForExtraction(containerId, mountPath);
  // The container-side scan remains defense in depth. The spool is the exact
  // byte stream validated below, so a worker cannot replace entries after that
  // scan but before the host extractor consumes them.
  const spoolDirectory = await mkdtemp(join(tmpdir(), 'arxic-worker-spool-'));
  let spooled = false;
  try {
    await spoolMountedResult(
      containerId,
      mountPath,
      join(spoolDirectory, 'result.tar'),
      quotaBytes,
    );
    spooled = true;
    return consumeSupervisorResultSpool(spoolDirectory, { quotaBytes, perFileBytes, fileLimit });
  } finally {
    if (!spooled) await rm(spoolDirectory, { recursive: true, force: true });
  }
}

/** Consume and remove a supervisor-owned spool. Validation deliberately
 * precedes staging creation, so callers never materialize rejected members. */
export async function consumeSupervisorResultSpool(
  spoolDirectory: string,
  limits: Readonly<{ quotaBytes: number; perFileBytes: number; fileLimit: number }>,
): Promise<RawArtifactSet> {
  const spoolPath = join(spoolDirectory, 'result.tar');
  try {
    await validateTarArchive(spoolPath);
    // Do not create host staging until the identical spooled archive has been
    // accepted. A rejected link can therefore never reach host extraction.
    const directory = await mkdtemp(join(tmpdir(), 'arxic-worker-result-'));
    try {
      await extractSpool(spoolPath, directory);
      const entries: RawArtifactEntry[] = [];
      const budget: ArtifactReadBudget = { totalBytes: 0, fileCount: 0 };
      await readRawEntries(directory, directory, entries, budget, limits);
      entries.sort((left, right) => left.path.localeCompare(right.path));
      return { entries };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } finally {
    await rm(spoolDirectory, { recursive: true, force: true });
  }
}

/** Reject filesystem objects that could alter host extraction semantics before
 * any archive bytes reach a host extractor. `mountPath` is the validated,
 * supervisor-owned tmpfs path and every expression token is a fixed argv item.
 */
async function assertResultTreeSafeForExtraction(
  containerId: string,
  mountPath: string,
): Promise<void> {
  const unsafe = await dockerExec(containerId, [
    'find',
    mountPath,
    '-xdev',
    '(',
    '-type',
    'l',
    '-o',
    '-type',
    'b',
    '-o',
    '-type',
    'c',
    '-o',
    '-type',
    'p',
    '-o',
    '-type',
    's',
    '-o',
    '(',
    '-type',
    'f',
    '-links',
    '+1',
    ')',
    ')',
    '-print',
  ]);
  if (unsafe.exit !== 0 || unsafe.stdout.length > 0) {
    throw new ArtifactImportError(
      'invalid',
      'Worker result contains an unsafe filesystem entry; host extraction was blocked',
    );
  }
}

/** Docker's archive endpoint cannot see container tmpfs mounts. Stream its tar
 * output to a supervisor-owned file, charging chunks before disk writes. The
 * heap never holds the result archive. */
async function spoolMountedResult(
  containerId: string,
  mountPath: string,
  spoolPath: string,
  quotaBytes: number,
): Promise<void> {
  const source = spawn('docker', ['exec', containerId, 'tar', '-C', mountPath, '-cf', '-', '.'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let sourceError = '';
  let spawnError: Error | undefined;
  let sourceExit: number | null = null;
  source.stderr.setEncoding('utf8').on('data', (chunk: string) => (sourceError += chunk));
  source.on('error', (error: Error) => (spawnError = error));
  const sourceClosed = new Promise<void>((resolveClosed) => {
    source.on('close', (code) => {
      sourceExit = code;
      resolveClosed();
    });
  });
  let streamedBytes = 0;
  let quotaError: ArtifactImportError | undefined;
  const quota = new Transform({
    transform(chunk: Buffer, _encoding, callback): void {
      const nextBytes = streamedBytes + chunk.byteLength;
      if (nextBytes > quotaBytes) {
        quotaError = new ArtifactImportError(
          'quota',
          'Worker result exceeded the cumulative byte quota',
        );
        callback(quotaError);
        return;
      }
      streamedBytes = nextBytes;
      callback(null, chunk);
    },
  });
  let pipelineError: unknown;
  try {
    await pipeline(
      source.stdout,
      quota,
      createWriteStream(spoolPath, { flags: 'wx', mode: 0o600 }),
    );
  } catch (error) {
    pipelineError = error;
  }
  await sourceClosed;
  if (quotaError) throw quotaError;
  if (spawnError) throw spawnError;
  if (pipelineError) throw pipelineError;
  if (sourceExit !== 0) {
    throw new Error(
      `stream worker result volume failed: ${sourceError || `tar exits ${sourceExit}`}`,
    );
  }
}

/** Extract only a tar archive that validateTarArchive accepted from the exact
 * spool path. Both paths are supervisor-owned fixed arguments. */
async function extractSpool(spoolPath: string, directory: string): Promise<void> {
  await new Promise<void>((resolveExtract, rejectExtract) => {
    const extractor = spawn('tar', ['-xf', spoolPath, '-C', directory], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let extractError = '';
    extractor.stderr.setEncoding('utf8').on('data', (chunk: string) => (extractError += chunk));
    extractor.on('error', rejectExtract);
    extractor.on('close', (code) => {
      if (code === 0) resolveExtract();
      else
        rejectExtract(
          new Error(`extract worker result volume failed: ${extractError || `tar exits ${code}`}`),
        );
    });
  });
}

async function assertResultVolumeCapacity(
  containerId: string,
  mountPath: string,
  quotaBytes: number,
): Promise<void> {
  const capacity = await dockerExec(containerId, ['df', '-k', '-P', mountPath]);
  requireSuccess('inspect worker result volume capacity', capacity);
  assertCapacityOutput(capacity.stdout, quotaBytes);
}

function assertCapacityOutput(output: string, quotaBytes: number): void {
  const lines = output.trim().split('\n');
  const values = lines.at(-1)?.trim().split(/\s+/) ?? [];
  // POSIX `df -P` fixes the data row to: filesystem, 1024-blocks, used,
  // available, capacity, mounted-on. A filesystem label may contain spaces, so
  // address the fixed numeric fields from the right.
  const totalSizeKilobytes = Number(values.at(-5));
  const totalSizeBytes = totalSizeKilobytes * 1024;
  // tmpfs is page-rounded by the kernel. Permit at most one 4 KiB page of
  // rounding while still rejecting an accidentally unbounded/mis-mounted path.
  if (
    !Number.isSafeInteger(totalSizeBytes) ||
    totalSizeBytes <= 0 ||
    totalSizeBytes > quotaBytes + 4096
  ) {
    throw new ArtifactImportError(
      'quota',
      `Worker result volume total-size limit is absent or exceeds its quota (${totalSizeBytes}/${quotaBytes}; ${output})`,
    );
  }
}

async function readRawEntries(
  root: string,
  directory: string,
  output: RawArtifactEntry[],
  budget: ArtifactReadBudget,
  limits: Readonly<{ quotaBytes: number; perFileBytes: number; fileLimit: number }>,
): Promise<void> {
  for (const name of await readdir(directory)) {
    const absolute = join(directory, name);
    const path = relative(root, absolute).split(sep).join('/');
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) {
      output.push({ path, kind: 'symlink' });
    } else if (stat.isDirectory()) {
      output.push({ path, kind: 'directory' });
      await readRawEntries(root, absolute, output, budget, limits);
    } else if (stat.isFile()) {
      budget.fileCount += 1;
      if (budget.fileCount > limits.fileLimit + 1) {
        throw new ArtifactImportError('quota', 'Worker result exceeded the file-count quota');
      }
      const read = await readArtifactWithinQuota(absolute, budget, {
        perFileBytes: limits.perFileBytes,
        totalBytes: limits.quotaBytes,
      });
      if (!read.accepted) {
        throw new ArtifactImportError(
          'quota',
          read.reason === 'file-size'
            ? `Worker artifact exceeded the per-file byte quota: ${path}`
            : 'Worker result exceeded the cumulative byte quota',
        );
      }
      output.push({ path, kind: 'regular', bytes: read.bytes });
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
  if (status === 'running' && sandbox.resultVolumeName) {
    const completed = await dockerExec(sandbox.containerId, [
      'cat',
      `${RESULT_EXPORT_PATH}/${RESULT_COMPLETE_MARKER}`,
    ]);
    if (completed.exit === 0 && /^\d+$/.test(completed.stdout)) {
      const completedExitCode = Number(completed.stdout);
      return {
        status: 'exited',
        exitCode: completedExitCode,
        oomKilled: oomKilled === 'true' || completedExitCode === 137 || completedExitCode === 139,
      };
    }
  }
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
