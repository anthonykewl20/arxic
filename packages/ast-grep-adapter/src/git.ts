import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd: root, encoding: 'utf8' });
  return stdout;
}

export async function committedRevision(
  root: string,
): Promise<{ commit: string | null; dirty: boolean }> {
  let commit: string | null;
  try {
    commit = (await git(root, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim() || null;
  } catch {
    return { commit: null, dirty: true };
  }
  const status = await git(root, ['status', '--porcelain', '--untracked-files=all']);
  return { commit, dirty: status.length > 0 };
}

export async function sourceFiles(root: string): Promise<string[]> {
  const output = await git(root, ['ls-files', '-z', '--cached']);
  return output
    .split('\0')
    .filter((path) => /\.(?:ts|tsx)$/u.test(path))
    .filter((path) => !/(?:^|\/)(?:node_modules|\.next|dist)(?:\/|$)/u.test(path))
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}
