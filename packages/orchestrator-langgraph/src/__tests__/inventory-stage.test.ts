import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FileStageCheckpointer,
  InMemoryStageCheckpointer,
  LangGraphOrchestrator,
  STAGE_EXECUTION_ORDER,
  type DomainInventoryStageArtifact,
  type RunState,
  type StageCheckpointer,
} from '..';
import { validateInventory } from '@arxic/domain-inventory';

/**
 * STAGE 13 'domain-inventory' (#250 / ADR-008 Consequences): the inventory
 * stage is wired AFTER structural extraction (graph position 2 → 13 → 3) with
 * the NEXT AVAILABLE ID (13) — existing stage IDs stay stable so persisted
 * runs and external stage references do not shift.
 *
 * Proven here end-to-end with REAL engines: the repository is a real git tree
 * with real TS + real PHP route files (BookStack provider-include shape), so
 * stage 13 runs the REAL DG-05 translator (`collectRouteInventories`,
 * Tree-sitter PHP), the REAL fusion-layer provider-include composition, the
 * REAL completeness validator, and the REAL evidence-graph fusion. The crawl
 * origin is a local HTTP server (§10: ephemeral port, no Mailpit env).
 */

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, '../../../..');
const temporaryDirectories: string[] = [];
let server: Server;
let origin = '';
let repository = '';
let commit = '';
let runsDirectory = '';
let artifactsDirectory = '';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Arxic Test',
  GIT_AUTHOR_EMAIL: 'test@arxic.invalid',
  GIT_COMMITTER_NAME: 'Arxic Test',
  GIT_COMMITTER_EMAIL: 'test@arxic.invalid',
};

describe('stage-13 domain-inventory (real DG-05 translator, real fusion)', () => {
  beforeAll(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-dg06-stage13-'));
    temporaryDirectories.push(directory);
    repository = await committedLaravelAndTsSource();
    runsDirectory = join(directory, 'runs');
    artifactsDirectory = join(directory, 'artifacts');
    server = createServer((request, response) => {
      response.setHeader(
        'content-type',
        request.url?.includes('.json') ? 'application/json' : 'text/html',
      );
      if (request.url === '/.well-known/arxic-test-target.json') {
        response.end(
          JSON.stringify({
            environmentClass: 'local-test',
            origin,
            allowedOrigins: [origin],
            buildDigest: 'a'.repeat(64),
            nonce: 'orchestrator-test',
          }),
        );
        return;
      }
      response.end('<!doctype html><title>Home</title><a href="/login">Login</a>');
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    origin = `http://127.0.0.1:${(address as { port: number }).port}`;
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await Promise.all(
      temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('runs after structural extraction with the next available id, and persists a valid inventory artifact', async () => {
    const result = await run('stage13-happy');

    expect(result.status).toMatch(/completed|partial/);
    // POSITION: 13 executes between 2 (structural-extraction) and 3 — and
    // the REAL full-run order deep-equals the exported canonical constant
    // (single source of truth for CLI/worker sequence validation; pins
    // constant ↔ graph-topology drift machine-caught).
    expect(result.completedStages).toEqual(STAGE_EXECUTION_ORDER);
    expect(result.completedStages.slice(0, 4)).toEqual([0, 1, 2, 13]);
    expect(result.completedStages).toHaveLength(14);
    // Existing stage IDs remain stable and ordered after the insertion.
    expect(result.completedStages.slice(4)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const checkpoint = result.checkpoints.find(({ stage }) => stage === 13);
    expect(checkpoint).toMatchObject({ name: 'domain-inventory', status: 'completed' });

    const envelope = (await stageArtifact(
      new FileStageCheckpointer(runsDirectory),
      result,
      'stage13-happy',
      13,
    )) as DomainInventoryStageArtifact;
    expect(envelope.kind).toBe('arxic-domain-inventory-stage-v1');
    expect(validateInventory(envelope.inventory).ok).toBe(true);
    // The REAL PHP pack ran: Laravel routes with the provider prefix applied.
    expect(envelope.inventory.rows.map((row) => row.key)).toEqual(
      expect.arrayContaining(['GET /books', 'GET /api/books', 'DELETE /api/books/:param']),
    );
    expect(envelope.providerIncludes.resolutions).toEqual([
      expect.objectContaining({
        includedFile: 'routes/api.php',
        prefixSegments: ['api'],
        appliedRoutes: 2,
      }),
    ]);
    // Evidence-graph fusion: rows landed, output-influencing edges grounded.
    expect(envelope.evidenceGraph.nodes).toBeGreaterThanOrEqual(7);
    expect(envelope.evidenceGraph.outputInfluencingEdges).toBeGreaterThanOrEqual(5);
    expect(envelope.evidenceGraph.diagnostics).toEqual([]);
    // Determinism: the stabilized inventory bytes hash is recorded in the run
    // dir; two runs over identical inputs reproduce it byte-for-byte.
    expect(envelope.stableSha256).toMatch(/^[a-f0-9]{64}$/u);
  }, 120_000);

  it('is byte-stable across runs (stabilized inventory + canonical graph sha)', async () => {
    const first = await envelopeOf('stage13-stable-1');
    const second = await envelopeOf('stage13-stable-2');
    expect(second.stableSha256).toBe(first.stableSha256);
    expect(second.evidenceGraph.canonicalSha256).toBe(first.evidenceGraph.canonicalSha256);
  }, 180_000);

  it('derives empty-coverage semantics from the inventory at stage 4', async () => {
    const result = await run('stage13-empty', {
      inferCandidates: async () => ({ requestId: 'empty-inventory-request', candidates: [] }),
    });
    expect(result.status).toBe('partial');
    const empty = result.diagnostics.find(({ code }) => code === 'ARXIC-ORCH-EMPTY-COVERAGE');
    // The honest zero names the denominator it is empty OVER.
    expect(empty?.message).toMatch(/domain inventory/u);
    expect(empty?.message).toMatch(/rows/u);
  }, 120_000);

  it('fails closed when the stage-1 artifact it consumes has drifted (hash mismatch)', async () => {
    const checkpointer = new DriftingStageOneCheckpointer();
    const result = await new LangGraphOrchestrator({
      checkpointer,
      inferCandidates: async () => ({ requestId: 'drift', candidates: [] }),
    }).run(input('stage13-drift'));

    expect(result.status).toBe('failed');
    expect(result.activeStage).toBe(13);
    const failed = result.checkpoints.find(({ stage }) => stage === 13);
    expect(failed?.status).toBe('failed');
    expect(result.completedStages).toEqual([0, 1, 2, 13].slice(0, 3));
  }, 120_000);

  async function run(runId: string, options: object = {}): Promise<RunState> {
    return new LangGraphOrchestrator({
      checkpointer: new FileStageCheckpointer(runsDirectory),
      ...options,
    }).run(input(runId));
  }

  async function envelopeOf(runId: string): Promise<DomainInventoryStageArtifact> {
    const result = await run(runId);
    return (await stageArtifact(
      new FileStageCheckpointer(runsDirectory),
      result,
      runId,
      13,
    )) as DomainInventoryStageArtifact;
  }

  function input(runId: string) {
    return {
      runId,
      origin,
      revision: { repository: pathToFileURL(repository).href, commit, dirty: false },
      rulepacksDir: resolve(root, 'rulepacks'),
      artifactsDir: artifactsDirectory,
      framework: 'nextjs',
      features: ['login'],
      maxUrls: 2,
      maxDepth: 1,
      appBuildDigest: 'a'.repeat(64),
      expectedNonce: 'orchestrator-test',
    } as const;
  }
});

/** Real git tree: TS page + Express route + Laravel routes + provider include. */
async function committedLaravelAndTsSource(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-dg06-source-'));
  temporaryDirectories.push(directory);
  await writeFile(
    join(directory, 'page.tsx'),
    'export default function Page() { return <main>home</main>; }\n',
  );
  await writeFile(
    join(directory, 'server.ts'),
    [
      'const app = { get(path: string, handler: unknown) { void handler; void path; } };',
      "app.get('/health', () => 200);",
      'export default app;',
      '',
    ].join('\n'),
  );
  await mkdir(join(directory, 'routes'), { recursive: true });
  await mkdir(join(directory, 'app/Providers'), { recursive: true });
  await writeFile(
    join(directory, 'routes/web.php'),
    `<?php\nuse Illuminate\\Support\\Facades\\Route;\nRoute::get('/books', [BookController::class, 'index']);\n`,
  );
  await writeFile(
    join(directory, 'routes/api.php'),
    `<?php\nuse Illuminate\\Support\\Facades\\Route;\nRoute::get('/books', [BookApiController::class, 'index']);\nRoute::delete('/books/{id}', [BookApiController::class, 'destroy']);\n`,
  );
  await writeFile(
    join(directory, 'app/Providers/RouteServiceProvider.php'),
    `<?php\nuse Illuminate\\Support\\Facades\\Route;\nclass RouteServiceProvider\n{\n    public function mapApiRoutes(): void\n    {\n        Route::group([\n            'middleware' => 'api',\n            'prefix'     => 'api',\n        ], function ($router) {\n            require base_path('routes/api.php');\n        });\n    }\n}\n`,
  );
  await execute('git', ['init', '--initial-branch=main'], { cwd: directory, env: GIT_ENV });
  await execute('git', ['add', '.'], { cwd: directory, env: GIT_ENV });
  await execute('git', ['commit', '-m', 'stage-13 fixture'], { cwd: directory, env: GIT_ENV });
  commit = (await execute('git', ['rev-parse', 'HEAD'], { cwd: directory })).stdout.trim();
  return directory;
}

async function stageArtifact(
  checkpointer: StageCheckpointer,
  state: RunState,
  runId: string,
  stage: number,
): Promise<unknown> {
  const ref = state.artifacts[stage as keyof RunState['artifacts']];
  if (!ref) throw new Error(`Stage ${stage} artifact reference is missing`);
  return checkpointer.readArtifact(runId, ref);
}

/**
 * Drifts the persisted stage-1 artifact bytes right after stage 2 commits
 * (before stage 13 runs): stage 13's immutable-artifact verification must
 * fail closed with a hash mismatch.
 */
class DriftingStageOneCheckpointer extends InMemoryStageCheckpointer {
  readonly #drifted = new Set<string>();
  async saveCheckpoint(
    runId: string,
    checkpoint: Parameters<StageCheckpointer['saveCheckpoint']>[1],
    state: Parameters<StageCheckpointer['saveCheckpoint']>[2],
  ): Promise<void> {
    await super.saveCheckpoint(runId, checkpoint, state);
    if (checkpoint.stage === 2 && !this.#drifted.has(runId)) {
      this.#drifted.add(runId);
      const value = (await super.readArtifact(runId, {
        id: 'stage:1',
        sha256: '0'.repeat(64),
      })) as Record<string, unknown>;
      await super.saveArtifact(runId, 1, { ...value, tampered: true });
    }
  }
}
