import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { SourceRevision } from '@arxic/contracts';

const exec = promisify(execFile);
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

async function git(cwd: string, ...args: string[]) {
  return (await exec('git', args, { cwd, env, encoding: 'utf8' })).stdout.trim();
}

export async function makeRepository(
  fixture?: 'reference-auth-app' | 'vulnerable-auth-app',
  files: Record<string, string> = {},
): Promise<{ root: string; revision: SourceRevision }> {
  const root = await mkdtemp(join(tmpdir(), 'arxic-rules-'));
  if (fixture)
    await cp(join(workspaceRoot, 'test-fixtures', fixture), root, {
      recursive: true,
      filter: (path) => !['node_modules', '.next', 'dist'].includes(basename(path)),
    });
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
  return { root, revision: { repository: pathToFileURL(root).href, commit, dirty: false } };
}

export async function writePack(
  parent: string,
  id: string,
  ruleId: string,
  malformed = false,
  framework: { name: string; versions: string } = { name: 'test', versions: '>=1' },
  rule: { language?: string; pattern?: string } = {},
): Promise<string> {
  const directory = join(parent, id);
  await mkdir(join(directory, 'rules'), { recursive: true });
  await writeFile(
    join(directory, 'pack.json'),
    malformed
      ? '{nope'
      : JSON.stringify({
          id,
          version: '1.0.0',
          framework,
          license: 'MIT',
          provenance: 'original-arxic',
          ruleDir: 'rules',
        }),
  );
  const language = rule.language ?? 'TypeScript';
  const pattern = rule.pattern ?? 'app.post($PATH, $$$ARGS)';
  await writeFile(
    join(directory, 'rules/rule.yml'),
    `id: ${ruleId}\nlanguage: ${language}\nmessage: test\nseverity: info\nrule:\n  pattern: ${pattern}\nmetadata:\n  arxic:\n    category: route\n    semver: 1.0.0\n    frameworkVersions: "${framework.versions}"\n    precision: test precision\n    fallback: test fallback\n    license: MIT\n    provenance: original-arxic\n`,
  );
  return directory;
}
