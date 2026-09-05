import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { collectFrontendInventory, SourceUaAdapter } from '../index';
import { makeRepository } from './test-repo';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it('keeps changed, malformed, unsupported and unsafe sources in the coverage gaps without inventing evidence', async () => {
  const repo = await makeRepository('reference-auth-app', {
    'src/Broken.tsx': 'export function Broken() { return <button',
    'src/Unknown.vue': '<template><button>Pay</button></template>',
  });
  roots.push(repo.root);
  const outside = await mkdtemp(join(tmpdir(), 'arxic-frontend-outside-'));
  roots.push(outside);
  await writeFile(
    join(outside, 'secret.tsx'),
    'export const Secret = () => <button>Secret</button>',
  );
  await symlink(join(outside, 'secret.tsx'), join(repo.root, 'leak.tsx'));
  const source = await new SourceUaAdapter().collect(repo.request);
  await writeFile(
    join(repo.root, 'app/login/page.tsx'),
    'export default () => <button>Changed</button>',
  );
  const result = await collectFrontendInventory(repo.root, source);
  expect(result.gaps).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: 'src/Broken.tsx', reason: 'parse-error' }),
      expect.objectContaining({ path: 'src/Unknown.vue', reason: 'unsupported-framework' }),
      expect.objectContaining({ path: 'leak.tsx', reason: 'unsafe-file' }),
      expect.objectContaining({ path: 'app/login/page.tsx', reason: 'source-changed' }),
    ]),
  );
  expect(
    result.rows.some((row) =>
      ['leak.tsx', 'app/login/page.tsx', 'src/Broken.tsx'].includes(row.source.path),
    ),
  ).toBe(false);
  expect(result.coverage.complete).toBe(false);
  expect(result.coverage.unobservedDimensions).toEqual([
    'persona',
    'feature-flag-value',
    'runtime-route',
    'runtime-state',
    'action-result',
    'viewport',
  ]);
});

it('inventories real Next.js components, controls, actions, conditions and existing tests with replayable source references', async () => {
  const repo = await makeRepository('reference-auth-app');
  roots.push(repo.root);
  const source = await new SourceUaAdapter().collect(repo.request);
  const result = await collectFrontendInventory(repo.root, source);
  const login = result.rows.filter((row) => row.source.path === 'app/login/page.tsx');
  expect(login).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'component', label: 'LoginPage' }),
      expect.objectContaining({ kind: 'control', label: 'input (name, type, required)' }),
      expect.objectContaining({ kind: 'action', label: 'action' }),
      expect.objectContaining({ kind: 'condition' }),
    ]),
  );
  expect(
    result.rows.some((row) => row.kind === 'test' && row.source.path === '__tests__/boot.test.ts'),
  ).toBe(true);
  expect(
    result.rows.every(
      (row) =>
        row.truthState === 'hypothesized' &&
        row.source.commit === repo.commit &&
        row.source.startLine > 0 &&
        row.source.endLine >= row.source.startLine &&
        /^[a-f0-9]{64}$/u.test(row.source.blobSha256),
    ),
  ).toBe(true);
  expect(
    result.rows.some((row) => row.kind === 'feature-flag' && row.label.startsWith('process.env.')),
  ).toBe(false);
  expect(
    result.rows.some((row) => row.kind === 'configuration' && row.label.startsWith('process.env.')),
  ).toBe(true);
  expect(await collectFrontendInventory(repo.root, source)).toEqual(result);
});

it('retains real Express documentation declarations while exposing its unsupported EJS frontend', async () => {
  const repo = await makeRepository('vulnerable-auth-app');
  roots.push(repo.root);
  const result = await collectFrontendInventory(
    repo.root,
    await new SourceUaAdapter().collect(repo.request),
  );
  expect(result.rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'requirement',
        basis: 'declaration',
        source: expect.objectContaining({ path: 'README.md' }),
      }),
    ]),
  );
  expect(result.gaps).toContainEqual({
    path: 'src/views/index.ejs',
    reason: 'unsupported-framework',
  });
});

it('reports truncated declarations and uncommitted sources explicitly instead of treating bounded scanning as complete', async () => {
  const repo = await makeRepository(undefined, {
    'requirements.md': '# Acceptance\n' + 'The app must show errors.\n'.repeat(20_010),
    'oversized.tsx': ' '.repeat(1024 * 1024 + 1),
  });
  roots.push(repo.root);
  await writeFile(
    join(repo.root, 'draft.tsx'),
    'export const Draft = () => <button>Draft</button>',
  );
  const result = await collectFrontendInventory(
    repo.root,
    await new SourceUaAdapter().collect(repo.request),
  );
  expect(result.rows).toHaveLength(20_000);
  expect(result.gaps).toEqual(
    expect.arrayContaining([
      { path: 'requirements.md', reason: 'inventory-budget' },
      { path: 'draft.tsx', reason: 'dirty' },
      { path: 'oversized.tsx', reason: 'oversize' },
    ]),
  );
  expect(result.revision.dirty).toBe(true);
  expect(result.files.find((file) => file.path === 'draft.tsx')).toMatchObject({
    status: 'gap',
    rows: 0,
  });
});
