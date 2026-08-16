#!/usr/bin/env node
// DG-01 measurement harness: runs the frozen SourceIndexer seam (SourceUaAdapter)
// against a real Laravel application working copy and emits a summary JSON with
// route-inventory counts, handler resolution, and the per-file PHP parse-failure
// rate. Local-only input; the emitted summary is safe to commit (aggregate
// counts + repo identity + commit SHA, no source content).
//
// Usage: node scripts/measure-laravel.mjs <repo-path> <label> [out.json]

import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// Node ≥23 strips types natively; import the adapter source directly so the
// measurement runs the exact code under review (no build step — ADR-003).
const { SourceUaAdapter } = await import('../src/index.ts');

const [repoPath, label, outPath] = process.argv.slice(2);
if (!repoPath || !label) {
  console.error('usage: node scripts/measure-laravel.mjs <repo-path> <label> [out.json]');
  process.exit(1);
}

const root = resolve(repoPath);
const { stdout: commitStdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: root });
const commit = commitStdout.trim();

const adapter = new SourceUaAdapter();
const document = await adapter.collect({
  revision: { repository: pathToFileURL(root).href, commit, dirty: false },
});

const phpFiles = document.manifest.filter((file) => file.language === 'php');
const phpIndexed = phpFiles.filter((file) => file.status === 'indexed');
const phpParseErrors = phpFiles.filter((file) => file.reason === 'parse-error');
const refs = document.events.flatMap((event) => ('ref' in event ? [event.ref] : []));
const routeRefs = refs.filter((ref) => ref.ruleId?.startsWith('route:'));
const handlerRefs = refs.filter((ref) => ref.ruleId?.startsWith('handler:'));
const advisories = document.events.flatMap((event) =>
  'diagnostic' in event ? [event.diagnostic] : [],
);

const routeCounts = {};
for (const ref of routeRefs) {
  const key = ref.ruleId.slice('route:'.length);
  routeCounts[key] = (routeCounts[key] ?? 0) + 1;
}

const summary = {
  label,
  repository:
    label === 'koel' ? 'https://github.com/koel/koel' : 'https://github.com/BookStackApp/BookStack',
  commit,
  scannedAt: new Date().toISOString(),
  php: {
    filesTotal: phpFiles.length,
    filesIndexed: phpIndexed.length,
    parseErrors: phpParseErrors.length,
    parseFailureRate: Number((phpParseErrors.length / Math.max(1, phpFiles.length)).toFixed(6)),
    parseErrorPaths: phpParseErrors.map((file) => file.path),
    otherSkips: phpFiles
      .filter((file) => file.status === 'skipped' && file.reason !== 'parse-error')
      .map((file) => ({ path: file.path, reason: file.reason })),
  },
  routes: {
    endpointRows: routeRefs.length,
    distinctMethodUri: Object.keys(routeCounts).length,
    duplicateMethodUri: Object.entries(routeCounts)
      .filter(([, count]) => count > 1)
      .map(([key, count]) => ({ key, count })),
  },
  handlers: {
    resolved: handlerRefs.length,
    distinct: new Set(handlerRefs.map((ref) => ref.ruleId)).size,
  },
  advisories: {
    routeDynamicRegistration: advisories.filter(
      (diagnostic) => diagnostic.code === 'ARXIC-SOURCE-ROUTE-DYNAMIC-REGISTRATION',
    ).length,
    handlerUnresolved: advisories.filter(
      (diagnostic) => diagnostic.code === 'ARXIC-SOURCE-HANDLER-UNRESOLVED',
    ).length,
    byCode: advisories.reduce((acc, diagnostic) => {
      acc[diagnostic.code] = (acc[diagnostic.code] ?? 0) + 1;
      return acc;
    }, {}),
  },
  toolVersions: document.toolVersions,
};

const json = JSON.stringify(summary, null, 2);
if (outPath) {
  await writeFile(outPath, json, 'utf8');
  console.log(`wrote ${outPath}`);
}
console.log(json);
