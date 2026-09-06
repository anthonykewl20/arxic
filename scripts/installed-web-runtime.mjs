import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Installed-process mechanics shared by HTTP and browser distribution assertions. */
export async function startInstalledWeb({ binary, env }) {
  binary = await realpath(binary);
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  if (!relative(repository, binary).startsWith(`..${sep}`))
    throw new Error('Installed web proof requires a binary outside the repository');
  const child = spawn(process.execPath, [binary, 'web'], {
    cwd: dirname(binary),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise((done) => child.once('exit', done));
  async function close() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    try {
      await exited;
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    const origin = await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Installed web startup timed out')), 20_000);
      let output = '';
      child.stderr.resume(); // Never retain arbitrary process output in UI evidence.
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Installed web exited before readiness (${code})`));
      });
      child.stdout.on('data', (bytes) => {
        output = (output + bytes.toString('utf8')).slice(-4096);
        const match = /Arxic workbench: (http:\/\/127\.0\.0\.1:\d+)/u.exec(output);
        if (match) {
          clearTimeout(timer);
          done(match[1]);
        }
      });
    });
    return { origin, close };
  } catch (error) {
    await close();
    throw error;
  }
}
