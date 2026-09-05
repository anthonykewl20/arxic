import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { dirname } from 'node:path';
import { SourceUaAdapter, diagnosticsOf, collectFrontendInventory } from '@arxic/source-ua-adapter';
import { buildSourceInventory } from '@arxic/domain-inventory';
import type { Run, RunResult } from './types';
import { sourceRevision } from './source';
import { campaignRows } from './campaigns';

async function runJob(run: Run): Promise<RunResult> {
  if (run.mode === 'review')
    return (await import('./visual-review')).reviewVisual(run, dirname(dirname(process.argv[3])));
  if (run.mode === 'visual')
    return (await import('./visual')).captureVisual(run, dirname(process.argv[3]));
  if (run.mode === 'agent')
    return (await import('./agent')).runAgent(run, dirname(process.argv[3]));
  const revision = await sourceRevision(run.project.folder);
  const adapter = new SourceUaAdapter();
  const request = {
    revision: {
      repository: pathToFileURL(run.project.folder).href,
      ...revision,
    },
  };
  const sourceIndex = await adapter.collect(request);
  const interchanges = await adapter.collectRouteInventories(request);
  const inventory = buildSourceInventory({ sourceIndex, interchanges });
  const diagnostics = diagnosticsOf(sourceIndex.events);
  const frontend = await collectFrontendInventory(run.project.folder, sourceIndex);
  return {
    outcome: sourceIndex.manifest.length ? 'hypothesized' : 'blocked',
    summary: `${inventory.rows.length} source surfaces across ${inventory.clusters.length} domains; ${frontend.rows.length} frontend declarations and ${frontend.gaps.length} explicit gaps. Source evidence is not runtime or business-acceptance proof.`,
    inventory,
    workflowRows: campaignRows(inventory),
    frontend,
    manifest: sourceIndex.manifest,
    diagnostics,
  };
}

if (process.env.ARXIC_WEB_JOB === '1') {
  process.on('disconnect', () => {
    if (process.platform !== 'win32') {
      try {
        process.kill(-process.pid, 'SIGKILL');
      } catch {
        process.exit(1);
      }
    } else process.exit(1);
  });
  let result: RunResult;
  try {
    result = await runJob(JSON.parse(await readFile(process.argv[2], 'utf8')) as Run);
  } catch {
    result = {
      outcome: 'blocked',
      summary:
        'Engine could not complete this run. Check the project Git history and configured runtime prerequisites.',
    };
  }
  await writeFile(process.argv[3], JSON.stringify(result), { mode: 0o600 });
  process.exit(0);
}
