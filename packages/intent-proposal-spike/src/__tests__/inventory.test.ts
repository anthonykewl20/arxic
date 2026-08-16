import { canonicalJson, validateDiagnostic } from '@arxic/contracts';
import type { EvidenceRef, EvidenceRefSource } from '@arxic/contracts';
import type { NormalizedSourceIndex } from '@arxic/source-ua-adapter';
import { describe, expect, it } from 'vitest';

type Fixture = {
  repo: string;
  commit: string;
  refs: EvidenceRefSource[];
  diagnostics?: unknown[];
};

const COMMIT = 'a'.repeat(40);

function sourceRef(
  over: Partial<EvidenceRefSource> & Pick<EvidenceRefSource, 'path' | 'ruleId'>,
): EvidenceRefSource {
  return {
    kind: 'source',
    repo: 'file:///fixture',
    commit: COMMIT,
    startLine: 1,
    endLine: 5,
    blobSha256: 'b'.repeat(64),
    extractor: 'tree-sitter-typescript@0.25.0',
    ...over,
  };
}

function makeIndex(fixture: Fixture): NormalizedSourceIndex {
  const events: Array<{ ref: EvidenceRef } | { diagnostic: never }> = fixture.refs.map((ref) => ({
    ref: ref as EvidenceRef,
  }));
  return {
    revision: { repository: fixture.repo, commit: fixture.commit, dirty: false },
    manifest: [],
    events: events as NormalizedSourceIndex['events'],
    toolVersions: { 'tree-sitter-typescript': '0.25.0' },
    generatedAt: '2026-08-16T00:00:00.000Z',
  };
}

function indexWithDiagnostics(fixture: Fixture): NormalizedSourceIndex {
  const index = makeIndex(fixture);
  return {
    ...index,
    events: [
      ...index.events,
      ...(fixture.diagnostics ?? []).map((diagnostic) => ({ diagnostic })),
    ] as NormalizedSourceIndex['events'],
  };
}

const scanDiagnostic = {
  code: 'ARXIC-SOURCE-UNSUPPORTED-LANGUAGE',
  severity: 'blocked',
  subject: 'app/Providers.php',
  message: 'Language php is outside scan policy.',
};

describe('domain inventory stand-in exporter (deterministic)', () => {
  it('projects one row per route/page finding with stable ids and resolvable evidence', async () => {
    const { exportInventory } = await import('../inventory');
    const inventory = exportInventory(
      makeIndex({
        repo: 'file:///fixture',
        commit: COMMIT,
        refs: [
          // Extractor value mirrors the real scanner output for Next.js file
          // conventions (scanner.ts toRef: 'source-ua-adapter/nextjs-file-conventions@0.0.0').
          sourceRef({
            path: 'app/login/page.tsx',
            ruleId: 'route:GET /login',
            startLine: 1,
            endLine: 12,
            blobSha256: '1'.repeat(64),
            extractor: 'source-ua-adapter/nextjs-file-conventions@0.0.0',
          }),
          sourceRef({
            path: 'src/server.ts',
            ruleId: 'route:POST /login',
            startLine: 34,
            endLine: 48,
            blobSha256: '2'.repeat(64),
          }),
          sourceRef({
            path: 'src/server.ts',
            ruleId: 'symbol:loginHandler',
            startLine: 3,
            endLine: 3,
            blobSha256: '2'.repeat(64),
          }),
          sourceRef({
            path: 'src/server.ts',
            ruleId: 'call:app.listen',
            startLine: 9,
            endLine: 9,
            blobSha256: '2'.repeat(64),
          }),
        ],
      }),
    );
    expect(inventory.rows).toHaveLength(2);
    const page = inventory.rows.find((row) => row.surface === 'page');
    const route = inventory.rows.find((row) => row.surface === 'route');
    expect(page).toMatchObject({ method: 'GET', path: '/login', sourcePath: 'app/login/page.tsx' });
    expect(route).toMatchObject({ method: 'POST', path: '/login', sourcePath: 'src/server.ts' });
    for (const row of inventory.rows) {
      expect(row.id).toMatch(/^inv:(route|page):[A-Z]+:[A-Za-z0-9._#/$~{}-]+:[0-9a-f]{8}:[0-9]+$/u);
      expect(row.evidenceIds.length).toBeGreaterThanOrEqual(1);
      for (const id of row.evidenceIds) expect(id).toMatch(/^src:/u);
      expect(row.domainHint).toMatch(/^[a-z0-9][a-z0-9-]*$/u);
    }
    // Stable, content-derived ids: same finding => same id.
    const again = exportInventory(
      makeIndex({
        repo: 'file:///fixture',
        commit: COMMIT,
        refs: [
          sourceRef({
            path: 'src/server.ts',
            ruleId: 'route:POST /login',
            startLine: 34,
            endLine: 48,
            blobSha256: '2'.repeat(64),
          }),
        ],
      }),
    );
    expect(again.rows[0]?.id).toBe(route?.id);
  });

  it('derives domainHint deterministically: first word-like path segment, else file stem', async () => {
    const { exportInventory } = await import('../inventory');
    const inventory = exportInventory(
      indexWithDiagnostics({
        repo: 'file:///fixture',
        commit: COMMIT,
        refs: [
          sourceRef({
            path: 'app/page.tsx',
            ruleId: 'route:GET /',
            blobSha256: '3'.repeat(64),
            extractor: 'source-ua-adapter/nextjs-file-conventions@0.0.0',
          }),
          sourceRef({
            path: 'api/src/controllers/items.ts',
            ruleId: 'route:GET /:id',
            blobSha256: '4'.repeat(64),
          }),
          sourceRef({
            path: 'src/well-known.ts',
            ruleId: 'route:GET /.well-known/arxic-test-target.json',
            blobSha256: '5'.repeat(64),
          }),
        ],
        diagnostics: [scanDiagnostic],
      }),
    );
    const byPath = new Map(inventory.rows.map((row) => [row.path, row.domainHint]));
    expect(byPath.get('/')).toBe('home');
    expect(byPath.get('/:id')).toBe('items');
    expect(byPath.get('/.well-known/arxic-test-target.json')).toBe('well-known');
  });

  it('merges duplicate findings for the same surface/method/path/file and keeps diagnostics', async () => {
    const { exportInventory } = await import('../inventory');
    const inventory = exportInventory(
      indexWithDiagnostics({
        repo: 'file:///fixture',
        commit: COMMIT,
        refs: [
          sourceRef({
            path: 'src/server.ts',
            ruleId: 'route:POST /login',
            startLine: 34,
            endLine: 48,
            blobSha256: '2'.repeat(64),
          }),
          sourceRef({
            path: 'src/server.ts',
            ruleId: 'route:POST /login',
            startLine: 34,
            endLine: 48,
            blobSha256: '2'.repeat(64),
            extractor: 'tree-sitter-javascript@0.25.0',
          }),
        ],
        diagnostics: [scanDiagnostic],
      }),
    );
    expect(inventory.rows).toHaveLength(1);
    const merged = new Set(inventory.rows[0]?.evidenceIds);
    expect(merged.size).toBeGreaterThanOrEqual(1);
    expect(inventory.diagnostics).toHaveLength(1);
    expect(validateDiagnostic(inventory.diagnostics[0])).toMatchObject({ ok: true });
  });

  it('is byte-stable across rebuilds (modulo timestamp) and marks itself a stand-in', async () => {
    const { exportInventory } = await import('../inventory');
    const index = makeIndex({
      repo: 'file:///fixture',
      commit: COMMIT,
      refs: [
        sourceRef({
          path: 'app/login/page.tsx',
          ruleId: 'route:GET /login',
          blobSha256: '1'.repeat(64),
        }),
        sourceRef({
          path: 'src/server.ts',
          ruleId: 'route:POST /forgot',
          startLine: 55,
          endLine: 72,
          blobSha256: '2'.repeat(64),
        }),
      ],
    });
    const first = exportInventory(index);
    const second = exportInventory(index);
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(first.kind).toBe('arxic-domain-inventory-standin-v1');
    expect(first.standIn).toBe(true);
  });

  it('builds an evidence index whose ids resolve to the real EvidenceRefs', async () => {
    const { exportInventory, buildEvidenceIndex } = await import('../inventory');
    const ref = sourceRef({
      path: 'src/server.ts',
      ruleId: 'route:POST /login',
      startLine: 34,
      endLine: 48,
      blobSha256: '2'.repeat(64),
    });
    const inventory = exportInventory(
      makeIndex({ repo: 'file:///fixture', commit: COMMIT, refs: [ref] }),
    );
    const evidenceIndex = buildEvidenceIndex(
      makeIndex({ repo: 'file:///fixture', commit: COMMIT, refs: [ref] }),
    );
    const cited = inventory.rows[0]?.evidenceIds[0];
    expect(cited).toBeDefined();
    const resolved = evidenceIndex[cited as string];
    expect(resolved).toMatchObject({ kind: 'source', path: 'src/server.ts', startLine: 34 });
  });
});
