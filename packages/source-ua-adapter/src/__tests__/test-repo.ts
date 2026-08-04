import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { SourceIndexRequest } from '@arxic/contracts';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '../../../..');
const FIXED_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Arxic Test',
  GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
  GIT_COMMITTER_NAME: 'Arxic Test',
  GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
  GIT_AUTHOR_DATE: '2026-08-04T12:00:00Z',
  GIT_COMMITTER_DATE: '2026-08-04T12:00:00Z',
};

export type TestRepository = {
  root: string;
  commit: string;
  request: SourceIndexRequest;
};

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, env: FIXED_ENV, encoding: 'utf8' });
  return stdout.trim();
}

export async function makeRepository(
  fixture?: 'reference-auth-app' | 'vulnerable-auth-app',
  extraFiles: Record<string, string | Buffer> = {},
): Promise<TestRepository> {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-source-ua-'));
  if (fixture) {
    const source = join(root, 'test-fixtures', fixture);
    await cp(source, directory, {
      recursive: true,
      filter: (path) => !['node_modules', '.next', 'dist'].includes(basename(path)),
    });
  }
  await writeFile(
    join(directory, '.gitignore'),
    'node_modules/\n.next/\ndist/\nauth.db*\ntsconfig.tsbuildinfo\n',
  );
  for (const [path, content] of Object.entries(extraFiles)) {
    await mkdir(join(directory, ...path.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(directory, ...path.split('/')), content);
  }
  await git(directory, 'init', '--initial-branch=main');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '-m', 'deterministic fixture');
  const commit = await git(directory, 'rev-parse', 'HEAD');
  return {
    root: directory,
    commit,
    request: {
      revision: { repository: pathToFileURL(directory).href, commit, dirty: false },
    },
  };
}

export async function makeNoCommitRepository(): Promise<SourceIndexRequest> {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-source-ua-empty-'));
  await git(directory, 'init', '--initial-branch=main');
  return {
    revision: {
      repository: pathToFileURL(directory).href,
      commit: '0'.repeat(40),
      dirty: false,
    },
  };
}

export async function makeShallowClone(source: TestRepository): Promise<TestRepository> {
  const parent = await mkdtemp(join(tmpdir(), 'arxic-source-ua-shallow-'));
  const destination = join(parent, 'repo');
  await git(parent, 'clone', '--depth', '1', pathToFileURL(source.root).href, destination);
  const commit = await git(destination, 'rev-parse', 'HEAD');
  return {
    root: destination,
    commit,
    request: {
      revision: { repository: pathToFileURL(destination).href, commit, dirty: false },
    },
  };
}
