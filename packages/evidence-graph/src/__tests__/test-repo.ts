import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { SourceIndexRequest, SourceRevision } from '@arxic/contracts';

const execute = promisify(execFile);
export const workspaceRoot = resolve(import.meta.dirname, '../../../..');
export const packDirs = [
  join(workspaceRoot, 'rulepacks/nextjs'),
  join(workspaceRoot, 'rulepacks/express'),
];
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Arxic Test',
  GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
  GIT_COMMITTER_NAME: 'Arxic Test',
  GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
  GIT_AUTHOR_DATE: '2026-08-05T12:00:00Z',
  GIT_COMMITTER_DATE: '2026-08-05T12:00:00Z',
};

export async function makeRepository(
  fixture?: 'reference-auth-app' | 'vulnerable-auth-app',
  files: Record<string, string> = {},
): Promise<{ root: string; revision: SourceRevision; request: SourceIndexRequest }> {
  const root = await mkdtemp(join(tmpdir(), 'arxic-evidence-graph-'));
  if (fixture) {
    await cp(join(workspaceRoot, 'test-fixtures', fixture), root, {
      recursive: true,
      filter: (path) => !['node_modules', '.next', 'dist'].includes(basename(path)),
    });
  }
  await writeFile(
    join(root, '.gitignore'),
    'node_modules/\n.next/\ndist/\nauth.db*\ntsconfig.tsbuildinfo\n',
  );
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, ...path.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  await git(root, 'init', '--initial-branch=main');
  await git(root, 'add', '.');
  await git(root, 'commit', '-m', 'fixture');
  const commit = await git(root, 'rev-parse', 'HEAD');
  const revision = { repository: pathToFileURL(root).href, commit, dirty: false };
  return { root, revision, request: { revision } };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execute('git', args, { cwd, env, encoding: 'utf8' })).stdout.trim();
}
