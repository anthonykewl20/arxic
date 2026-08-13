import { execFile } from 'node:child_process';
import { link, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { validateDiagnostic } from '@arxic/contracts';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SOURCE_SCAN_POLICY, SourceUaAdapter, diagnosticsOf } from '..';
import { makeRepository } from './test-repo';

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
  repo.commit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: repo.root })).stdout.trim();
  repo.request.revision.commit = repo.commit;
}

async function addSymlink(
  repo: Awaited<ReturnType<typeof makeRepository>>,
  path: string,
  target: string,
): Promise<void> {
  const destination = join(repo.root, path);
  await mkdir(dirname(destination), { recursive: true });
  await symlink(target, destination);
}

describe('SourceUaAdapter hostile source containment with real Tree-sitter', () => {
  it('rejects absolute, relative, deep, and looping tracked symlinks without reading targets', async () => {
    const repo = await makeRepository(undefined, { 'src/safe.ts': 'export const safe = true;\n' });
    const outside = await mkdtemp(join(tmpdir(), 'arxic-source-secret-'));
    const secret = join(outside, 'secret.ts');
    await writeFile(secret, 'export const leaked = "DO_NOT_READ";\n');
    await addSymlink(repo, 'src/absolute.ts', secret);
    await addSymlink(repo, 'src/relative.ts', '../../' + outside.split('/').at(-1) + '/secret.ts');
    await addSymlink(repo, 'src/deep/nested/escape.ts', secret);
    await addSymlink(repo, 'src/loop.ts', 'loop.ts');
    await commit(repo);

    const document = await new SourceUaAdapter().collect(repo.request);
    const unsafe = diagnosticsOf(document.events).filter(
      (diagnostic) => diagnostic.code === 'ARXIC-SOURCE-UNSAFE-FILE',
    );
    expect(unsafe.map((diagnostic) => diagnostic.subject).sort()).toEqual([
      'src/absolute.ts',
      'src/deep/nested/escape.ts',
      'src/loop.ts',
      'src/relative.ts',
    ]);
    expect(document.events.some((event) => JSON.stringify(event).includes('DO_NOT_READ'))).toBe(
      false,
    );
    expect(unsafe.every((diagnostic) => validateDiagnostic(diagnostic).ok)).toBe(true);
  });

  it('stats before reading and skips an oversized tracked file with bounded real-engine input', async () => {
    const repo = await makeRepository(undefined, {
      'src/large.ts': `export const large = '${'x'.repeat(4096)}';\n`,
      'src/safe.ts': 'export function safe() { return true; }\n',
    });
    const policy = { ...DEFAULT_SOURCE_SCAN_POLICY, maxFileSizeBytes: 128 };
    const document = await new SourceUaAdapter({ policy }).collect(repo.request);

    expect(document.manifest.find((file) => file.path === 'src/large.ts')).toMatchObject({
      reason: 'oversize',
      sizeBytes: 4121,
      status: 'skipped',
    });
    expect(
      document.events.some(
        (event) =>
          'ref' in event && event.ref.kind === 'source' && event.ref.path === 'src/safe.ts',
      ),
    ).toBe(true);
  });

  it('rejects a FIFO instead of opening the non-regular source path', async () => {
    const repo = await makeRepository(undefined, {
      'src/safe.ts': 'export const safe = true;\n',
      'src/source.ts': 'export const replaced = true;\n',
    });
    await rm(join(repo.root, 'src/source.ts'));
    await exec('mkfifo', ['src/source.ts'], { cwd: repo.root });

    const document = await new SourceUaAdapter().collect(repo.request);
    expect(diagnosticsOf(document.events)).toContainEqual(
      expect.objectContaining({
        code: 'ARXIC-SOURCE-UNSAFE-FILE',
        severity: 'blocked',
        subject: 'src/source.ts',
        message: 'Only regular files may be collected.',
      }),
    );
  });

  it('rejects an in-root hard link to an external file', async () => {
    const repo = await makeRepository(undefined, { 'src/safe.ts': 'export const safe = true;\n' });
    const outside = await mkdtemp(join(tmpdir(), 'arxic-source-hardlink-'));
    const secret = join(outside, 'secret.ts');
    await writeFile(secret, 'export const secret = "DO_NOT_READ";\n');
    await link(secret, join(repo.root, 'src/hardlink.ts'));

    const document = await new SourceUaAdapter().collect(repo.request);
    expect(diagnosticsOf(document.events)).toContainEqual(
      expect.objectContaining({
        code: 'ARXIC-SOURCE-UNSAFE-FILE',
        severity: 'blocked',
        subject: 'src/hardlink.ts',
      }),
    );
  });
});
