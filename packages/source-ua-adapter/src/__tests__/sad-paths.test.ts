import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ARXIC_SOURCE_BINARY_FILE,
  ARXIC_SOURCE_DIRTY_TREE,
  ARXIC_SOURCE_FILE_OVERSIZE,
  ARXIC_SOURCE_NO_COMMIT,
  ARXIC_SOURCE_PARSE_ERROR,
  ARXIC_SOURCE_SHALLOW_CLONE,
  ARXIC_SOURCE_UNSUPPORTED_LANGUAGE,
  DEFAULT_SOURCE_SCAN_POLICY,
  SourceUaAdapter,
  diagnosticsOf,
} from '..';
import { makeNoCommitRepository, makeRepository, makeShallowClone } from './test-repo';

describe('SourceUaAdapter sad paths', () => {
  it('reports unsupported tracked files as blocked gaps and never parses them', async () => {
    const repo = await makeRepository(undefined, { 'styles.css': 'body {}' });
    const document = await new SourceUaAdapter().collect(repo.request);
    expect(document.manifest.find((file) => file.path === 'styles.css')).toMatchObject({
      status: 'skipped',
      reason: 'unsupported-language',
    });
    expect(
      diagnosticsOf(document.events).some(
        (item) => item.code === ARXIC_SOURCE_UNSUPPORTED_LANGUAGE,
      ),
    ).toBe(true);
    expect(
      document.events.some(
        (event) => 'ref' in event && event.ref.kind === 'source' && event.ref.path === 'styles.css',
      ),
    ).toBe(false);
  });

  it('manifests dirty bytes without manufacturing committed source provenance', async () => {
    const repo = await makeRepository(undefined, {
      'src/dirty.ts': 'export function before() {}\n',
    });
    await writeFile(join(repo.root, 'src/dirty.ts'), 'export function after() {}\n');
    const document = await new SourceUaAdapter().collect(repo.request);
    expect(document.revision.dirty).toBe(true);
    expect(document.manifest.find((file) => file.path === 'src/dirty.ts')).toMatchObject({
      reason: 'dirty',
    });
    expect(
      diagnosticsOf(document.events).find((item) => item.code === ARXIC_SOURCE_DIRTY_TREE)?.message,
    ).toContain('src/dirty.ts');
    expect(
      document.events.some(
        (event) =>
          'ref' in event && event.ref.kind === 'source' && event.ref.path === 'src/dirty.ts',
      ),
    ).toBe(false);
  });

  it('skips binary files within quota with a blocked diagnostic', async () => {
    const repo = await makeRepository(undefined, { 'src/binary.ts': Buffer.from([0, 1, 2]) });
    const document = await new SourceUaAdapter().collect(repo.request);
    expect(document.manifest.find((file) => file.path === 'src/binary.ts')?.reason).toBe('binary');
    expect(
      diagnosticsOf(document.events).some((item) => item.code === ARXIC_SOURCE_BINARY_FILE),
    ).toBe(true);
  });

  it('skips files over the policy quota', async () => {
    const repo = await makeRepository(undefined, { 'src/large.ts': 'export const value = 1;\n' });
    const policy = { ...DEFAULT_SOURCE_SCAN_POLICY, maxFileSizeBytes: 8 };
    const document = await new SourceUaAdapter({ policy }).collect(repo.request);
    expect(document.manifest.find((file) => file.path === 'src/large.ts')?.reason).toBe('oversize');
    expect(
      diagnosticsOf(document.events).some((item) => item.code === ARXIC_SOURCE_FILE_OVERSIZE),
    ).toBe(true);
  });

  it('retains a blocked diagnostic for a partial Tree-sitter parse without crashing', async () => {
    const repo = await makeRepository(undefined, {
      'src/broken.ts': 'export function broken( {\n',
    });
    const document = await new SourceUaAdapter().collect(repo.request);
    expect(document.manifest.find((file) => file.path === 'src/broken.ts')?.reason).toBe(
      'parse-error',
    );
    expect(
      diagnosticsOf(document.events).some((item) => item.code === ARXIC_SOURCE_PARSE_ERROR),
    ).toBe(true);
  });

  it('fails closed when a repository has no commit', async () => {
    const document = await new SourceUaAdapter().collect(await makeNoCommitRepository());
    expect(document.manifest).toEqual([]);
    expect(diagnosticsOf(document.events).map((item) => item.code)).toEqual([
      ARXIC_SOURCE_NO_COMMIT,
    ]);
  });

  it('fails closed for a shallow clone', async () => {
    const source = await makeRepository(undefined, { 'src/index.ts': 'export const value = 1;\n' });
    const shallow = await makeShallowClone(source);
    const document = await new SourceUaAdapter().collect(shallow.request);
    expect(document.manifest).toEqual([]);
    expect(diagnosticsOf(document.events).map((item) => item.code)).toEqual([
      ARXIC_SOURCE_SHALLOW_CLONE,
    ]);
  });
});
