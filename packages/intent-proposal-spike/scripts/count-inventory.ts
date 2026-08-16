/**
 * DG-04 utility: count the stand-in inventory rows the real Tree-sitter
 * adapter extracts from a real target repository (reproducibility helper for
 * the spike report; not part of the library surface).
 *
 * Usage: pnpm exec tsx scripts/count-inventory.ts <repo-root>
 */
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { exportInventory } from '../src/inventory';
import { SourceUaAdapter } from '@arxic/source-ua-adapter';

const exec = promisify(execFile);
const target = process.argv[2];
if (!target) throw new Error('usage: tsx scripts/count-inventory.ts <repo-root>');
const commit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: target })).stdout.trim();
const adapter = new SourceUaAdapter();
const index = await adapter.collect({
  revision: { repository: pathToFileURL(target).href, commit, dirty: false },
});
const inventory = exportInventory(index);
const hints = new Map<string, number>();
for (const row of inventory.rows) hints.set(row.domainHint, (hints.get(row.domainHint) ?? 0) + 1);
console.log(
  JSON.stringify(
    {
      commit,
      filesIndexed: index.manifest.filter((file) => file.status === 'indexed').length,
      rows: inventory.rows.length,
      domainHints: hints.size,
      diagnostics: inventory.diagnostics.length,
      topHints: [...hints.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
    },
    null,
    1,
  ),
);
