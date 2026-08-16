import { execFile } from 'node:child_process';
import { canonicalJson, validateEvidenceRef } from '@arxic/contracts';
import { ModelAdapter } from '@arxic/model-adapter';
import { SourceUaAdapter } from '@arxic/source-ua-adapter';
import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { DomainInventory } from '../inventory';
import { STUB_BEARER, STUB_MODEL, startStub } from './stub';

const exec = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, '../../../..');

const FIXED_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Arxic Test',
  GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
  GIT_COMMITTER_NAME: 'Arxic Test',
  GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
  GIT_AUTHOR_DATE: '2026-08-16T12:00:00Z',
  GIT_COMMITTER_DATE: '2026-08-16T12:00:00Z',
};

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, env: FIXED_ENV, encoding: 'utf8' });
  return stdout.trim();
}

async function fixtureRepository(
  fixture: 'reference-auth-app' | 'vulnerable-auth-app',
): Promise<{ root: string; commit: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-dg04-'));
  await cp(join(repoRoot, 'test-fixtures', fixture), directory, {
    recursive: true,
    filter: (path) => !['node_modules', '.next', 'dist'].includes(basename(path)),
  });
  await import('node:fs/promises').then((fs) =>
    fs.writeFile(
      join(directory, '.gitignore'),
      'node_modules/\n.next/\ndist/\nauth.db*\ntsconfig.tsbuildinfo\n',
    ),
  );
  await git(directory, 'init', '--initial-branch=main');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '-m', 'dg04 fixture');
  const commit = await git(directory, 'rev-parse', 'HEAD');
  return { root: directory, commit };
}

describe('real-world: real Tree-sitter inventory -> real HTTP endpoint -> grounded proposals', () => {
  it('proposes grounded, deduped, non-auth intents for the real Next.js reference app', async () => {
    const { exportInventory, buildEvidenceIndex, IntentProposer } = await import('..');
    const repo = await fixtureRepository('reference-auth-app');
    const adapter = new SourceUaAdapter();
    const index = await adapter.collect({
      revision: { repository: pathToFileURL(repo.root).href, commit: repo.commit, dirty: false },
    });
    const inventory = exportInventory(index);
    const evidenceIndex = buildEvidenceIndex(index);
    // Real extraction grounded in the real app: pages exist, evidence resolves.
    expect(inventory.rows.some((row) => row.path === '/login' && row.surface === 'page')).toBe(
      true,
    );
    expect(inventory.rows.some((row) => row.path === '/change-password')).toBe(true);
    for (const row of inventory.rows) {
      expect(row.evidenceIds.length).toBeGreaterThanOrEqual(1);
      const resolved = evidenceIndex[row.evidenceIds[0]];
      expect(resolved).toBeDefined();
      expect(validateEvidenceRef(resolved)).toMatchObject({ ok: true });
    }

    const stub = await startStub('smart');
    try {
      const model = new ModelAdapter({
        credentials: STUB_BEARER,
        baseUrl: stub.baseUrl,
        canaries: [STUB_BEARER],
      });
      const proposer = new IntentProposer({
        adapter: model,
        model: STUB_MODEL,
        strategy: { kind: 'per-domain', maxRowsPerCall: 3 },
      });
      const first = await proposer.propose({
        inventory,
        evidenceIndex,
        runId: 'dg04-real-1',
      });
      const second = await proposer.propose({
        inventory,
        evidenceIndex,
        runId: 'dg04-real-2',
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const { proposals, coverage, ...firstRest } = first.result;
      expect(proposals.length).toBeGreaterThanOrEqual(3);
      // Non-auth generality: the pipeline carries domains beyond authentication
      // (home page, mfa, infrastructure seed surfaces) with no auth literal involved.
      const domains = new Set(proposals.map((p) => p.domain));
      expect(domains.size).toBeGreaterThanOrEqual(3);
      expect([...domains].every((d) => typeof d === 'string')).toBe(true);
      // Grounding: every proposal cites real rows + resolvable evidence, and nothing else.
      const rowIds = new Set(inventory.rows.map((row) => row.id));
      for (const proposal of proposals) {
        expect(proposal.inventoryRowIds.length).toBeGreaterThanOrEqual(1);
        for (const id of proposal.inventoryRowIds) expect(rowIds.has(id)).toBe(true);
        for (const id of proposal.evidenceRefIds) expect(evidenceIndex[id]).toBeDefined();
        expect(proposal.boundEvidenceRefs.every((ref) => validateEvidenceRef(ref).ok)).toBe(true);
        expect(proposal.truthState).toBe('hypothesized');
      }
      expect(coverage.coveredRows).toBe(inventory.rows.length);
      // Determinism: two runs over identical inputs agree modulo request ids,
      // latency, and wall-clock timestamps recorded inside run records.
      const strip = (value: unknown) =>
        JSON.parse(
          JSON.stringify(value, (key, val) =>
            key === 'requestId' || key === 'latencyMs' || key === 'callId' || key === 'timestamp'
              ? undefined
              : val,
          ),
        );
      expect(canonicalJson(strip({ ...firstRest, proposals, coverage }))).toBe(
        canonicalJson(strip(second.ok ? second.result : { missing: true })),
      );
    } finally {
      await stub.close();
    }
  });

  it('keeps the auth template OUT of the proposal path: no authentication literal in proposer messages', async () => {
    const { buildProposerMessages } = await import('..');
    const rows = [
      {
        id: 'inv:route:GET:/dashboards:00000001:3',
        surface: 'route' as const,
        method: 'GET',
        path: '/dashboards',
        sourcePath: 'api/dashboards.ts',
        domainHint: 'dashboards',
        evidenceIds: ['src:api-dashboards-ts:3-9'],
      },
    ];
    for (const message of buildProposerMessages(rows, 1)) {
      expect(/authenticat/iu.test(message.content)).toBe(false);
    }
  });

  it('exposes the honest uncovered-row ledger when the model proposes nothing for a domain', async () => {
    const { IntentProposer } = await import('..');
    const stub = await startStub('empty-proposals');
    try {
      const model = new ModelAdapter({ credentials: STUB_BEARER, baseUrl: stub.baseUrl });
      const proposer = new IntentProposer({
        adapter: model,
        model: STUB_MODEL,
        strategy: { kind: 'per-domain', maxRowsPerCall: 3 },
      });
      const rows = [
        {
          id: 'inv:route:GET:/a:00000001:1',
          surface: 'route' as const,
          method: 'GET',
          path: '/a',
          sourcePath: 'src/a.ts',
          domainHint: 'alpha',
          evidenceIds: ['src:src-a-ts:1-2'],
        },
        {
          id: 'inv:route:GET:/b:00000002:1',
          surface: 'route' as const,
          method: 'GET',
          path: '/b',
          sourcePath: 'src/b.ts',
          domainHint: 'beta',
          evidenceIds: ['src:src-b-ts:1-2'],
        },
      ];
      const evidenceIndex = Object.fromEntries(
        rows.map((row, n) => [
          row.evidenceIds[0],
          {
            kind: 'source' as const,
            repo: 'file:///fixture',
            commit: 'a'.repeat(40),
            path: row.sourcePath,
            startLine: 1,
            endLine: 2,
            blobSha256: String(n).repeat(64),
            extractor: 'tree-sitter-typescript@0.25.0',
          },
        ]),
      );
      const inventory: DomainInventory = {
        kind: 'arxic-domain-inventory-standin-v1',
        standIn: true,
        rows,
        source: { tool: 'test', commit: 'a'.repeat(40), repository: 'file:///fixture' },
        diagnostics: [],
      };
      const outcome = await proposer.propose({
        inventory,
        evidenceIndex,
        runId: 'dg04-empty',
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.result.coverage.uncoveredRows).toHaveLength(2);
      expect(stub.requests).toHaveLength(2); // one call per domain
    } finally {
      await stub.close();
    }
  });
});
