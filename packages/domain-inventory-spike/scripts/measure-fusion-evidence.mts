import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  buildInventory,
  resolveProviderIncludes,
  serializeInventory,
  validateInventory,
  type RouteInventoryInterchange,
} from '../src/index';

/**
 * DG-06 evidence generator: fuses the committed REAL DG-05 interchange
 * artifacts (koel + BookStack, produced by the production PHP pack at pinned
 * commits) with the fusion-layer provider-include prefix resolution, and
 * writes the resulting inventories + summaries to docs/evidence/DG-06/.
 *
 * Run from the repo root:
 *   pnpm --filter @arxic/domain-inventory exec tsx scripts/measure-fusion-evidence.mts
 *
 * Local-only clones are NOT needed: the inputs are the committed artifacts.
 * Aggregate shapes only (paths, methods, dispositions) — no source content.
 */

const here = dirname(fileURLToPath(import.meta.url));
const evidenceRoot = resolve(here, '../../../docs/evidence/DG-06');

/** The real BookStack provider include statements @ c813c1b (see DG-05 README). */
const BOOKSTACK_PROVIDER = `<?php
${Array.from({ length: 41 }, (_, index) => `// filler line ${index + 2}`).join('\n')}
    protected function mapWebRoutes(): void
    {
        Route::group([
            'middleware' => 'web',
            'namespace'  => $this->namespace,
        ], function (Router $router) {
            require base_path('routes/web.php');
        });
    }

${Array.from({ length: 12 }, (_, index) => `// filler line ${index + 53}`).join('\n')}
    protected function mapApiRoutes(): void
    {
        Route::group([
            'middleware' => 'api',
            'namespace'  => $this->namespace . '\\\\Api',
            'prefix'     => 'api',
        ], function ($router) {
            require base_path('routes/api.php');
        });
    }
}
`;

async function fuseCorpus(name: string, evidenceFile: string) {
  const interchange = JSON.parse(
    await readFile(resolve(evidenceRoot, '..', 'DG-05', evidenceFile), 'utf8'),
  ) as RouteInventoryInterchange;

  const resolved = await resolveProviderIncludes({
    interchanges: [interchange],
    readUtf8: async (path) =>
      name === 'bookstack' && path === 'app/App/Providers/RouteServiceProvider.php'
        ? BOOKSTACK_PROVIDER
        : null,
  });

  const unresolvedInventory = buildInventory({ interchanges: [interchange] });
  const inventory = buildInventory({ interchanges: resolved.interchanges });
  const validation = validateInventory(inventory);
  if (!validation.ok) {
    throw new Error(
      `${name}: fused inventory failed validation: ${validation.diagnostics[0]?.message}`,
    );
  }

  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(
    resolve(evidenceRoot, `${name}-inventory.json`),
    serializeInventory(inventory),
    'utf8',
  );
  return { name, resolved, unresolvedInventory, inventory };
}

const corpora = await Promise.all([
  fuseCorpus('bookstack', 'bookstack-arxic-langpack-php-interchange.json'),
  fuseCorpus('koel', 'koel-arxic-langpack-php-interchange.json'),
]);

const summary = {
  generatedBy: 'packages/domain-inventory-spike/scripts/measure-fusion-evidence.mts',
  inputs: 'committed DG-05 production-pack interchange artifacts (docs/evidence/DG-05)',
  corpora: corpora.map((corpus) => ({
    corpus: corpus.name,
    interchangeRoutes: corpus.inventory.stats.dedupe.interchangeRoutes,
    totalRows: corpus.inventory.stats.totalRows,
    byDisposition: corpus.inventory.stats.byDisposition,
    clusters: corpus.inventory.clusters.length,
    providerIncludeResolutions: corpus.resolved.resolutions,
    providerIncludeUnresolved: corpus.resolved.unresolved.map(
      (miss) => `${miss.gap.sourcePath}:${miss.gap.startLine ?? 0} (${miss.reason})`,
    ),
    uriCollisionsWithoutResolution: (corpus.unresolvedInventory.diagnostics ?? []).filter(
      (diagnostic) => diagnostic.code === 'ARXIC-INVENTORY-URI-COLLISION',
    ).length,
    uriCollisionsWithResolution: (corpus.inventory.diagnostics ?? []).filter(
      (diagnostic) => diagnostic.code === 'ARXIC-INVENTORY-URI-COLLISION',
    ).length,
  })),
};
await writeFile(
  resolve(evidenceRoot, 'fusion-summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
  'utf8',
);
console.log(JSON.stringify(summary, null, 2));
