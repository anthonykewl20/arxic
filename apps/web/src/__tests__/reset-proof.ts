import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { inspectPlaywrightTrace } from '../../../../packages/playwright-trace-sanitizer/src';
import type { ResetEvent } from './reset-diagnostic';

/** Opt-in safe evidence export; never copy the run directory or a raw trace. */
export async function retainResetProof(state: string, events: ResetEvent[]) {
  const output = process.env.ARXIC_RESET_PROOF_DIR;
  if (!output) return;
  await mkdir(output, { recursive: true });
  const files = (await readdir(state, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
  const hashes = new Set<string>();
  let screenshots = 0;
  let timelines = 0;
  for (const file of files.filter((file) => file.endsWith('.png'))) {
    const sidecar = file + '.privacy.json';
    if (!files.includes(sidecar)) continue;
    const bytes = await readFile(file);
    const provenance = await readFile(sidecar);
    const parsed = JSON.parse(provenance.toString());
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== (parsed.screenshotSha256 ?? parsed.sha256 ?? parsed.screenshot?.sha256)) {
      throw new Error('Reset screenshot provenance mismatch');
    }
    if (hashes.has(hash)) continue;
    hashes.add(hash);
    const name = `reset-${++screenshots}.png`;
    await writeFile(join(output, name), bytes);
    await writeFile(join(output, name + '.privacy.json'), provenance);
  }
  for (const file of files.filter((file) => file.endsWith('.zip'))) {
    for (const sidecar of files.filter(
      (path) => basename(path) === basename(file) + '.sanitization.json',
    )) {
      const inspected = await inspectPlaywrightTrace({ tracePath: file, provenancePath: sidecar });
      if (!inspected.ok || hashes.has(inspected.traceSha256)) continue;
      hashes.add(inspected.traceSha256);
      const name = `timeline-${++timelines}.zip`;
      await writeFile(join(output, name), inspected.traceBytes);
      await writeFile(join(output, name + '.sanitization.json'), inspected.provenanceBytes);
    }
  }
  if (!screenshots || !timelines)
    throw new Error('Reset proof is missing safe screenshots or timelines');
  await writeFile(
    join(output, 'side-effects.json'),
    JSON.stringify(
      {
        profile: 'real-nextjs-delayed-first-replay',
        delayMs: 800,
        events,
        screenshots,
        timelines,
        humanInspection: 'not performed',
        rawTraceRetained: false,
      },
      null,
      2,
    ),
  );
}
