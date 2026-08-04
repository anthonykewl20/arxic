import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

export async function resolveCommit(root: string): Promise<string | null> {
  try {
    return (await git(root, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim() || null;
  } catch {
    return null;
  }
}

export async function isShallowRepository(root: string): Promise<boolean> {
  return (await git(root, ['rev-parse', '--is-shallow-repository'])).trim() === 'true';
}

function nulPaths(output: string): string[] {
  return output.split('\0').filter(Boolean);
}

export async function enumerateFiles(root: string): Promise<string[]> {
  const paths = nulPaths(
    await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
  );
  return [...new Set(paths)].sort(bytewiseCompare);
}

export async function dirtyPaths(root: string): Promise<string[]> {
  const outputs = await Promise.all([
    git(root, ['diff', '--name-only', '-z']),
    git(root, ['diff', '--cached', '--name-only', '-z']),
    git(root, ['ls-files', '-z', '--others', '--exclude-standard']),
  ]);
  return [...new Set(outputs.flatMap(nulPaths))].sort(bytewiseCompare);
}

export function bytewiseCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}
