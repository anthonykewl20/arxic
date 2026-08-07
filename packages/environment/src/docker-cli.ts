import { execFile, type ExecFileException } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 30_000;

export type DockerResult = Readonly<{ exit: number; stdout: string; stderr: string }>;
export type DockerExecOptions = Readonly<{ timeoutMs?: number }>;

async function invoke(
  args: readonly string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<DockerResult> {
  try {
    const { stdout, stderr } = await execute('docker', [...args], {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { exit: 0, stdout: stdout.trimEnd(), stderr: stderr.trimEnd() };
  } catch (error) {
    const failure = error as ExecFileException & { stdout?: string; stderr?: string };
    return {
      exit: typeof failure.code === 'number' ? failure.code : failure.killed ? 124 : 1,
      stdout: String(failure.stdout ?? '').trimEnd(),
      stderr: String(failure.stderr ?? failure.message ?? '').trimEnd(),
    };
  }
}

export function dockerVersion(): Promise<DockerResult> {
  return invoke(['version', '--format', '{{.Server.Version}}'], 10_000);
}

export function dockerRunDetach(fullArgs: readonly string[]): Promise<DockerResult> {
  return invoke(['run', '-d', ...fullArgs]);
}

export function dockerExec(
  container: string,
  cmdArgs: readonly string[],
  options: DockerExecOptions = {},
): Promise<DockerResult> {
  return invoke(['exec', container, ...cmdArgs], options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
}

export async function dockerInspect(
  container: string,
  goTemplate: string,
  resource: 'container' | 'network' = 'container',
): Promise<string> {
  const noun = resource === 'network' ? ['network', 'inspect'] : ['inspect'];
  const result = await invoke([...noun, '--format', goTemplate, container]);
  if (result.exit !== 0) throw new Error(result.stderr || `docker inspect exited ${result.exit}`);
  return result.stdout;
}

export async function dockerInspectJson(container: string): Promise<unknown> {
  const result = await invoke(['inspect', container]);
  if (result.exit !== 0) throw new Error(result.stderr || `docker inspect exited ${result.exit}`);
  return JSON.parse(result.stdout) as unknown;
}

export async function dockerRm(container: string): Promise<DockerResult> {
  const result = await invoke(['rm', '-f', container]);
  if (result.exit !== 0 && /No such container/i.test(result.stderr)) {
    return { exit: 0, stdout: '', stderr: '' };
  }
  return result;
}

/** Supervisor-only hard stop; workers never receive Docker access. */
export function dockerKill(container: string): Promise<DockerResult> {
  return invoke(['kill', '--signal', 'KILL', container]);
}

export function networkCreate(
  input: Readonly<{ name: string; internal: boolean }>,
): Promise<DockerResult> {
  return invoke(['network', 'create', ...(input.internal ? ['--internal'] : []), input.name]);
}

export async function networkRm(name: string): Promise<DockerResult> {
  const result = await invoke(['network', 'rm', name]);
  if (result.exit !== 0 && /not found|No such network/i.test(result.stderr)) {
    return { exit: 0, stdout: '', stderr: '' };
  }
  return result;
}

export function networkConnect(
  network: string,
  container: string,
  aliases: readonly string[] = [],
): Promise<DockerResult> {
  return invoke([
    'network',
    'connect',
    ...aliases.flatMap((alias) => ['--alias', alias]),
    network,
    container,
  ]);
}
