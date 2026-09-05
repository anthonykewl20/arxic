import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** Git mechanics; callers decide whether changed/dirty source may execute. */
export async function sourceRevision(folder: string) {
  const options = { cwd: folder, timeout: 10_000, maxBuffer: 1024 * 1024 };
  const [head, status] = await Promise.all([
    execute('git', ['rev-parse', '--verify', 'HEAD^{commit}'], options),
    execute('git', ['status', '--porcelain', '--untracked-files=all'], options),
  ]);
  return { commit: head.stdout.trim(), dirty: status.stdout.length > 0 };
}
