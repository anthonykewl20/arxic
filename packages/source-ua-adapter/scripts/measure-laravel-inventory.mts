#!/usr/bin/env node
// DG-05 measurement harness: runs the frozen SourceIndexer seam against a real
// Laravel application working copy and emits (1) the pack's RouteInventory
// Interchange document and (2) an aggregate summary, validated with the REAL
// DG-02 validator. Local-only input; committed artifacts carry aggregate data
// + repo identity + commit SHA, never source content.
//
// Usage: npx tsx packages/source-ua-adapter/scripts/measure-laravel-inventory.mjs \
//          <repo-path> <label> <out-dir>

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { SourceUaAdapter } from '../src/index.ts';
import { validateInterchange } from '../../domain-inventory-spike/src/interchange.ts';

const exec = promisify(execFile);

const [repoPath, label, outDir] = process.argv.slice(2);
if (!repoPath || !label || !outDir) {
  console.error(
    'usage: npx tsx scripts/measure-laravel-inventory.mjs <repo-path> <label> <out-dir>',
  );
  process.exit(1);
}

const root = resolve(repoPath);
const { stdout: commitStdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: root });
const commit = commitStdout.trim();

const adapter = new SourceUaAdapter();
const request = {
  revision: { repository: pathToFileURL(root).href, commit, dirty: false },
};
const inventories = await adapter.collectRouteInventories(request);
const document = await adapter.collect(request);

const validations = inventories.map((interchange) => ({
  packId: interchange.packId,
  ok: validateInterchange(interchange).ok,
}));

const phpFiles = document.manifest.filter((file) => file.language === 'php');
const summary = {
  label,
  repository: label === 'koel' ? 'https://github.com/koel/koel' : label,
  commit,
  scannedAt: new Date().toISOString(),
  php: {
    filesTotal: phpFiles.length,
    indexed: phpFiles.filter((file) => file.status === 'indexed').length,
    parseErrors: phpFiles.filter((file) => file.reason === 'parse-error').length,
    grammarUnavailable: phpFiles.filter((file) => file.reason === 'grammar-unavailable').length,
  },
  inventories: inventories.map((interchange) => ({
    packId: interchange.packId,
    standIn: interchange.standIn,
    routes: interchange.routes.length,
    routesConditional: interchange.routes.filter((route) => route.conditional === true).length,
    routesWithMiddleware: interchange.routes.filter((route) => route.middleware !== undefined)
      .length,
    gaps: interchange.gaps.length,
    gapsByKind: interchange.gaps.reduce((acc, gap) => {
      acc[gap.kind] = (acc[gap.kind] ?? 0) + 1;
      return acc;
    }, {}),
    files: interchange.files.length,
    handlerEvidenceRefs: document.events.filter(
      (event) => 'ref' in event && event.ref.ruleId?.startsWith('handler:'),
    ).length,
  })),
  validation: validations,
  toolVersions: document.toolVersions,
};

await mkdir(resolve(outDir), { recursive: true });
for (const interchange of inventories) {
  const name = interchange.packId.split('@')[0]?.replace(/[^a-z0-9-]/gu, '') ?? 'pack';
  await writeFile(
    resolve(outDir, `${label}-${name}-interchange.json`),
    JSON.stringify(interchange, null, 2),
    'utf8',
  );
}
await writeFile(resolve(outDir, `${label}-summary.json`), JSON.stringify(summary, null, 2), 'utf8');
console.log(JSON.stringify(summary, null, 2));
if (validations.some((entry) => !entry.ok)) {
  console.error('INTERCHANGE VALIDATION FAILED');
  process.exit(1);
}
