import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { SourceUaAdapter } from '@arxic/source-ua-adapter';
import { afterAll, describe, expect, it } from 'vitest';
import { buildInventory, resolveProviderIncludes, serializeInventory, validateInventory } from '..';

/**
 * END-TO-END TRANSLATOR INTEGRATION (binding #250 contract comment): DG-05's
 * producer-side drift must be proven fixed at the PIPELINE STAGE, not just in
 * the pack — `SourceUaAdapter.collectRouteInventories()` (REAL Tree-sitter
 * PHP through the DG-05 translator, unmodified) → `RouteInventoryInterchange`
 * → provider-include prefix resolution → fused inventory.
 *
 * The fixture is a REAL git repository with REAL PHP route files in the
 * BookStack provider-include shape; the engines (tree-sitter@0.22.4 +
 * tree-sitter-php@0.23.12 via the language pack) are the production ones.
 * `estimatedRouteCount` (the DG-05 review-round field) is exercised on the
 * emitted include gap.
 */

const execute = promisify(execFile);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `arxic-dg06-translator-${prefix}`));
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

/** Real Laravel-shaped repo: provider include with `api` prefix + route files. */
async function laravelRepository(): Promise<{ repository: string; commit: string }> {
  const directory = await temporaryDirectory('repo-');
  await writeFile(
    join(directory, 'composer.json'),
    `${JSON.stringify({ name: 'acme/api-app', require: { 'laravel/framework': '^13.0' } }, null, 2)}\n`,
  );
  await mkdir(join(directory, 'routes'), { recursive: true });
  await mkdir(join(directory, 'app/Providers'), { recursive: true });
  await writeFile(
    join(directory, 'routes/web.php'),
    `<?php\nuse Illuminate\\Support\\Facades\\Route;\nRoute::get('/books', [BookController::class, 'index']);\nRoute::post('/books', [BookController::class, 'store']);\n`,
  );
  await writeFile(
    join(directory, 'routes/api.php'),
    `<?php\nuse Illuminate\\Support\\Facades\\Route;\nRoute::get('/books', [BookApiController::class, 'index']);\nRoute::delete('/books/{id}', [BookApiController::class, 'destroy']);\n`,
  );
  // The BookStack provider shape: the per-file scan cannot apply this prefix.
  await writeFile(
    join(directory, 'app/Providers/RouteServiceProvider.php'),
    `<?php\nuse Illuminate\\Support\\Facades\\Route;\nclass RouteServiceProvider\n{\n    public function mapApiRoutes(): void\n    {\n        Route::group([\n            'middleware' => 'api',\n            'prefix'     => 'api',\n        ], function ($router) {\n            require base_path('routes/api.php');\n        });\n    }\n}\n`,
  );
  await execute('git', ['init', '--initial-branch=main'], { cwd: directory, env: GIT_ENV });
  await execute('git', ['add', '.'], { cwd: directory, env: GIT_ENV });
  await execute('git', ['commit', '-m', 'laravel fixture'], { cwd: directory, env: GIT_ENV });
  const commit = (
    await execute('git', ['rev-parse', 'HEAD'], { cwd: directory, env: GIT_ENV })
  ).stdout.trim();
  return { repository: `file://${directory}`, commit };
}

describe('DG-05 translator end-to-end at the inventory stage (real Tree-sitter PHP)', () => {
  it('collectRouteInventories() output fuses; provider prefix resolution fixes the URI collisions', async () => {
    const repo = await laravelRepository();
    const adapter = new SourceUaAdapter();
    const revision = { repository: repo.repository, commit: repo.commit, dirty: false };

    // 1. The REAL producer: DG-05 translator through the frozen seam.
    const collected = await adapter.collectRouteInventories({ revision });
    expect(collected).toHaveLength(1);
    const pack = collected[0]!;
    expect(pack.packId).toBe('arxic-langpack-php@1.0.0');
    expect(pack.standIn).toBe(false);
    // Four registrations (per-file, prefix not yet applied) + the include gap.
    expect(pack.routes).toHaveLength(4);
    expect(pack.gaps).toEqual([
      expect.objectContaining({
        kind: 'unresolved-file',
        sourcePath: 'app/Providers/RouteServiceProvider.php',
        reason: expect.stringContaining('routes/api.php'),
        estimatedRouteCount: 2,
      }),
    ]);

    // 2. Fusion-layer provider-include composition (two-pass, real files).
    const resolved = await resolveProviderIncludes({
      interchanges: collected,
      readUtf8: async (path) => {
        if (path !== 'app/Providers/RouteServiceProvider.php') return null;
        const { readFile } = await import('node:fs/promises');
        try {
          return await readFile(`${repo.repository.slice('file://'.length)}/${path}`, 'utf8');
        } catch {
          return null;
        }
      },
    });
    expect(resolved.resolutions).toEqual([
      {
        providerPath: 'app/Providers/RouteServiceProvider.php',
        includeLine: expect.any(Number) as number,
        includedFile: 'routes/api.php',
        prefixSegments: ['api'],
        appliedRoutes: 2,
        estimatedRouteCount: 2,
      },
    ]);

    // 3. Fuse + validate: the previously colliding GET /books and
    //    POST-adjacent rows split; completeness holds; bytes are stable.
    const inventory = buildInventory({ interchanges: resolved.interchanges });
    expect(inventory.stats.byDisposition.extracted).toBe(4);
    expect(inventory.rows.map((row) => row.key)).toEqual(
      expect.arrayContaining([
        'GET /books',
        'POST /books',
        'GET /api/books',
        'DELETE /api/books/:param',
      ]),
    );
    expect(
      (inventory.diagnostics ?? []).filter((d) => d.code === 'ARXIC-INVENTORY-URI-COLLISION'),
    ).toHaveLength(0);
    expect(validateInventory(inventory).ok).toBe(true);
    const rebuilt = buildInventory({ interchanges: resolved.interchanges });
    expect(serializeInventory(rebuilt)).toBe(serializeInventory(inventory));
  });

  it('without resolution the real pack output keeps URI collisions VISIBLE (no silent merges)', async () => {
    const repo = await laravelRepository();
    const adapter = new SourceUaAdapter();
    const collected = await adapter.collectRouteInventories({
      revision: { repository: repo.repository, commit: repo.commit, dirty: false },
    });

    const inventory = buildInventory({ interchanges: collected });
    const collisions = (inventory.diagnostics ?? []).filter(
      (diagnostic) => diagnostic.code === 'ARXIC-INVENTORY-URI-COLLISION',
    );
    // GET /books collides across web.php and api.php.
    expect(collisions.map((diagnostic) => diagnostic.subject)).toEqual(['GET /books']);
    expect(validateInventory(inventory).ok).toBe(true);
  });

  it('the mixed TS + PHP denominator fuses both sides (real scan both engines)', async () => {
    const repo = await laravelRepository();
    const adapter = new SourceUaAdapter();
    const revision = { repository: repo.repository, commit: repo.commit, dirty: false };
    const sourceIndex = await adapter.collect({ revision });
    const collected = await adapter.collectRouteInventories({ revision });

    const inventory = buildInventory({ sourceIndex, interchanges: collected });
    expect(validateInventory(inventory).ok).toBe(true);
    // PHP files appear in the scan manifest as indexed code; the TS side has
    // no route findings in this fixture — the denominator is PHP-driven.
    expect(inventory.inputs.interchangePacks).toEqual(['arxic-langpack-php@1.0.0']);
    expect(inventory.stats.byDisposition.extracted).toBeGreaterThanOrEqual(3);
  });
});
