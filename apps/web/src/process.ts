import { fork, execFile, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export async function stopProcess(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) =>
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => resolve()),
    );
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

export function launchJob(input: string, result: string, overrides?: NodeJS.ProcessEnv) {
  const require = createRequire(import.meta.url);
  const env: NodeJS.ProcessEnv = { ...process.env, ARXIC_WEB_JOB: '1' };
  delete env.ARXIC_ADMIN_TOKEN;
  delete env.ARXIC_MODEL_CONNECTIONS;
  env.ARXIC_MODEL_IMAGE_DIRECTORY = join(dirname(result), '.model-images');
  if (overrides) {
    for (const key of Object.keys(env)) if (key.startsWith('ARXIC_SECRET_')) delete env[key];
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
  const child = fork(fileURLToPath(new URL('./job.ts', import.meta.url)), [input, result], {
    execArgv: ['--import', require.resolve('tsx')],
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env,
  });
  const finished = new Promise<number | null>((resolve) => {
    child.once('error', () => resolve(null));
    child.once('exit', (code) => {
      // A successful/failed job may leave a provider descendant holding pipes.
      // This process group was allocated solely for this job by fork(detached).
      if (process.platform !== 'win32' && child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* Group already exited. */
        }
      }
      resolve(code);
    });
  });
  return { child, finished };
}
