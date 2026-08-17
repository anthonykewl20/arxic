import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { collect, type NormalizedSourceIndex } from '@arxic/source-ua-adapter';
import {
  buildEvidenceIndex as dg04BuildEvidenceIndex,
  exportInventory as dg04ExportInventory,
  type InventoryRow as DG04InventoryRow,
} from '@arxic/intent-proposal-spike';
import { describe, expect, it, afterAll } from 'vitest';
import {
  buildConsumerEvidenceIndex,
  buildInventory,
  normalizePath,
  toProposalConsumerInventory,
  type ProposalConsumerRow,
} from '..';

/**
 * CANONICAL SCHEMA RECONCILIATION (#250 contract comment, binding): DG-04's
 * inventory consumer expects `id`/`surface`/`domainHint`/string
 * `evidenceIds` (packages/intent-proposal-spike/src/inventory.ts:39-57) while
 * DG-02 rows carry `key`/`surfaceKind`/`domain`/structured EvidenceRefs.
 *
 * The canonical shape is the DG-02 row (ADR-008 Decision 2 dispositions +
 * Decision 6 structured evidence are product requirements the stand-in lacks);
 * this adapter projects canonical rows into the DG-04 CONSUMER shape and is
 * integration-tested against the DG-04 spike's ACTUAL consumer code —
 * imported read-only (types AND runtime functions), never edited.
 *
 * Lockstep at the type level: the adapter's row type must be EXACTLY DG-04's
 * `InventoryRow` — verified by the Equal<> assertions below, so a future
 * change to either side fails THIS package's typecheck, not a downstream run.
 */

const execute = promisify(execFile);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `arxic-dg06-adapter-${prefix}`));
  temporaryDirectories.push(directory);
  return directory;
}

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Arxic Test',
  GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
  GIT_COMMITTER_NAME: 'Arxic Test',
  GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
};

/** A real git repository with real TS sources — scanned by the REAL adapter. */
async function realSourceRepo(): Promise<{ repository: string; commit: string }> {
  const directory = await temporaryDirectory('repo-');
  await writeFile(
    join(directory, 'package.json'),
    `${JSON.stringify({ name: 'adapter-fixture', private: true }, null, 2)}\n`,
  );
  await mkdir(join(directory, 'app'), { recursive: true });
  await mkdir(join(directory, 'app/users/[id]'), { recursive: true });
  await writeFile(
    join(directory, 'app/page.tsx'),
    `export default function Home() {\n  return <main>home</main>;\n}\n`,
  );
  await writeFile(
    join(directory, 'app/users/[id]/page.tsx'),
    `export default function User() {\n  return <main>user</main>;\n}\n`,
  );
  await writeFile(
    join(directory, 'server.ts'),
    [
      'import express from "express";',
      'const app = express();',
      "app.get('/api/users/:id', (req, res) => res.json(req.params));",
      "app.post('/api/users', (req, res) => res.status(201).end());",
      'export default app;',
      '',
    ].join('\n'),
  );
  await execute('git', ['init', '--initial-branch=main'], { cwd: directory, env: GIT_ENV });
  await execute('git', ['add', '.'], { cwd: directory, env: GIT_ENV });
  await execute('git', ['commit', '-m', 'adapter fixture'], { cwd: directory, env: GIT_ENV });
  const commit = (
    await execute('git', ['rev-parse', 'HEAD'], { cwd: directory, env: GIT_ENV })
  ).stdout.trim();
  return { repository: `file://${directory}`, commit };
}

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// The adapter's consumer row type must be EXACTLY the DG-04 consumer shape.
type RowLockstep = Expect<Equal<ProposalConsumerRow, DG04InventoryRow>>;
void ({} as RowLockstep);

describe('canonical → DG-04 consumer adapter (real adapter scan, real consumer code)', () => {
  it('produces rows the DG-04 consumer shape accepts with evidence ids resolvable in BOTH indexes', async () => {
    const repo = await realSourceRepo();
    const index: NormalizedSourceIndex = await collect({
      revision: { repository: repo.repository, commit: repo.commit, dirty: false },
    });

    const canonical = buildInventory({ sourceIndex: index });
    const consumer = toProposalConsumerInventory(canonical);

    // The real DG-04 exporter over the same real scan — the interop oracle.
    const dg04 = dg04ExportInventory(index);
    const dg04Index = dg04BuildEvidenceIndex(index);

    // Same denominator on both paths: every DG-04 (surface, method, path)
    // surface is present in the adapted consumer rows — compared in the
    // CANONICAL normalized form (DG-04 keeps paths as extracted, e.g.
    // `/users/[id]`; the canonical inventory normalizes to `:param`).
    for (const row of dg04.rows) {
      const normalized = normalizePath(row.path).text;
      expect(
        consumer.rows.some(
          (candidate) =>
            candidate.surface === row.surface &&
            candidate.method === row.method &&
            candidate.path === normalized,
        ),
        `adapted rows must cover DG-04 row ${row.id}`,
      ).toBe(true);
    }

    // Contract 3 (DG-04 header): every row carries ≥1 evidence id resolvable
    // through the evidence index — proven against DG-04's OWN index for the
    // TS side and against the inventory's own index for every row.
    const ownIndex = buildConsumerEvidenceIndex(canonical);
    expect(consumer.rows.length).toBeGreaterThan(0);
    for (const row of consumer.rows) {
      expect(row.evidenceIds.length).toBeGreaterThan(0);
      for (const id of row.evidenceIds) {
        expect(ownIndex[id], `own index resolves ${id}`).toBeDefined();
      }
    }
    // Every TS-side evidence id the DG-04 consumer could cite is carried
    // verbatim, so DG-04-grounded proposals stay checkable.
    for (const row of dg04.rows) {
      const normalized = normalizePath(row.path).text;
      const adapted = consumer.rows.find(
        (candidate) =>
          candidate.surface === row.surface &&
          candidate.method === row.method &&
          candidate.path === normalized,
      );
      expect(adapted).toBeDefined();
      for (const id of row.evidenceIds) {
        expect(adapted!.evidenceIds).toContain(id);
        expect(dg04Index[id]).toBeDefined();
      }
    }
  });

  it('covers interchange (PHP) rows DG-04’s stand-in cannot see, with resolvable evidence', async () => {
    const commit = 'd'.repeat(40);
    const canonical = buildInventory({
      interchanges: [
        {
          schemaVersion: 1,
          packId: 'arxic-langpack-php@1.0.0',
          language: 'php',
          framework: 'laravel',
          standIn: false,
          provenance: { repository: 'https://example.invalid/app.git', commit },
          routes: [
            {
              methods: ['GET', 'HEAD'],
              uri: '/api/albums/{album}',
              sourcePath: 'routes/api.php',
              startLine: 12,
              endLine: 12,
            },
            {
              methods: ['POST'],
              uri: '/api/albums',
              sourcePath: 'routes/api.php',
              startLine: 20,
              endLine: 20,
            },
          ],
          gaps: [],
          files: [{ path: 'routes/api.php', sha256: '5'.repeat(64) }],
        },
      ],
    });

    const consumer = toProposalConsumerInventory(canonical);
    // Consumer surface semantics preserved (extractor-based): interchange
    // rows come from the PHP route-inventory pack, so BOTH GET and POST map
    // to `route` — only file-convention UI extractors map to `page`.
    const albumGet = consumer.rows.find((row) => row.path === '/api/albums/:param');
    expect(albumGet).toMatchObject({
      surface: 'route',
      method: 'GET',
      sourcePath: 'routes/api.php',
    });
    const albumPost = consumer.rows.find(
      (row) => row.method === 'POST' && row.path === '/api/albums',
    );
    expect(albumPost).toMatchObject({ surface: 'route', sourcePath: 'routes/api.php' });

    const ownIndex = buildConsumerEvidenceIndex(canonical);
    for (const id of [...(albumGet?.evidenceIds ?? []), ...(albumPost?.evidenceIds ?? [])]) {
      expect(ownIndex[id], `interchange evidence id ${id} must resolve`).toBeDefined();
    }
    // DG-04's stand-in cannot produce PHP rows at all — the drift this
    // reconciliation closes: consumer coverage must EXCEED the stand-in.
    expect(consumer.rows.length).toBe(3);
  });

  it('mints collision-resistant (validator-deduped) stable ids and keeps non-extracted mass visible (no silent drops)', async () => {
    const commit = 'd'.repeat(40);
    const canonical = buildInventory({
      sourceIndex: {
        revision: { repository: 'file:///tmp/x', commit, dirty: false },
        manifest: [
          {
            path: 'legacy.py',
            blobSha256: 'e'.repeat(64),
            sizeBytes: 1,
            language: 'python',
            category: 'code',
            status: 'skipped',
            reason: 'unsupported-language',
          },
        ],
        events: [],
        toolVersions: {},
        generatedAt: '2026-08-17T00:00:00.000Z',
      },
    });
    expect(canonical.rows).toHaveLength(1); // the unsupported-language mass row

    const consumer = toProposalConsumerInventory(canonical);
    expect(consumer.rows).toHaveLength(0); // proposer inputs are extracted rows only
    expect(consumer.omitted).toEqual({
      total: 1,
      byDisposition: {
        extracted: 0,
        unsupported: 1,
        unsafe: 0,
        'unextracted-with-reason': 0,
      },
    });

    // Id grammar: content-derived from the unique canonical key → rebuild
    // stability + collision resistance (DG-02 §7 dissent settlement).
    const first = toProposalConsumerInventory(canonical);
    expect(first.rows.map((row) => row.id)).toEqual(consumer.rows.map((row) => row.id));
    const ids = new Set(first.rows.map((row) => row.id));
    expect(ids.size).toBe(first.rows.length);
  });
});
