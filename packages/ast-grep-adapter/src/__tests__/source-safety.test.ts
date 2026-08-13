import { execFile } from 'node:child_process';
import { link as hardLink, mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { validateDiagnostic } from '@arxic/contracts';
import { describe, expect, it } from 'vitest';
import { AstGrepAdapter, diagnosticsOf, sourceRefsOf } from '..';
import { makeRepository, packDirs } from './test-repo';

const exec = promisify(execFile);

async function commit(repo: Awaited<ReturnType<typeof makeRepository>>): Promise<void> {
  await exec('git', ['add', '.'], { cwd: repo.root });
  await exec('git', ['commit', '-m', 'hostile source tree'], {
    cwd: repo.root,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Arxic Test',
      GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
      GIT_COMMITTER_NAME: 'Arxic Test',
      GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
    },
  });
  repo.revision.commit = (
    await exec('git', ['rev-parse', 'HEAD'], { cwd: repo.root })
  ).stdout.trim();
}

describe('AstGrepAdapter hostile source containment with the real sg CLI', () => {
  it('rejects an escaping tracked symlink and oversized file while scanning a safe file', async () => {
    const repo = await makeRepository(undefined, {
      'src/safe.ts': "app.post('/login', (_request, _response) => {});\n",
      'src/large.ts': `app.post('/large', () => '${'x'.repeat(4096)}');\n`,
    });
    const outside = await mkdtemp(join(tmpdir(), 'arxic-rules-secret-'));
    const secret = join(outside, 'secret.ts');
    await writeFile(secret, "app.post('/leaked', (_request, _response) => {});\n");
    const link = join(repo.root, 'src/deep/escape.ts');
    await mkdir(dirname(link), { recursive: true });
    await symlink(secret, link);
    await symlink(
      '../../' + outside.split('/').at(-1) + '/secret.ts',
      join(repo.root, 'src/relative.ts'),
    );
    await symlink('loop.ts', join(repo.root, 'src/loop.ts'));
    await hardLink(secret, join(repo.root, 'src/hardlink.ts'));
    await commit(repo);

    const result = await new AstGrepAdapter({
      packs: packDirs,
      maxFileSizeBytes: 128,
    }).scan({ revision: repo.revision, framework: 'express' });
    const diagnostics = diagnosticsOf(result.events);
    expect(
      diagnostics
        .filter((diagnostic) => diagnostic.code === 'ARXIC-RULES-UNSAFE-SOURCE')
        .map((diagnostic) => diagnostic.subject)
        .sort(),
    ).toEqual(['src/deep/escape.ts', 'src/hardlink.ts', 'src/loop.ts', 'src/relative.ts']);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'ARXIC-RULES-SOURCE-OVERSIZE',
        severity: 'blocked',
        subject: 'src/large.ts',
      }),
    );
    expect(result.matches).toContainEqual(
      expect.objectContaining({ file: 'src/safe.ts', ruleId: 'express-route' }),
    );
    expect(result.matches.some((match) => match.fields.PATH === "'/leaked'")).toBe(false);
    expect(sourceRefsOf(result.events).every((ref) => ref.path === 'src/safe.ts')).toBe(true);
    expect(diagnostics.every((diagnostic) => validateDiagnostic(diagnostic).ok)).toBe(true);
  });
});
