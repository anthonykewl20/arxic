import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { Workbench } from '../workbench';

it('reports partial recovery accurately when a later durable deletion becomes protected', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'retention-partial-'));
  const wb = await Workbench.open(directory, [resolve(import.meta.dirname, '../../../..')]);
  try {
    await wb.idle();
    const project = await wb.saveProject({ name: 'Recovery boundary', folder: wb.roots[0] });
    // Database/filesystem boundary supplement; actual capture recovery has separate real-app proof.
    const runs = [wb.store.enqueue(project, 'discovery')!, wb.store.enqueue(project, 'discovery')!];
    for (const run of runs)
      wb.store.saveRun({ ...run, state: 'completed', finishedAt: new Date().toISOString() });
    await writeFile(join(directory, 'runs'), 'unavailable storage');
    for (const run of runs) await expect(wb.deleteRun(run.id)).rejects.toThrow('cleanup failed');
    expect(wb.retentionState().pendingDeletions).toBe(2);
    await rm(join(directory, 'runs'));
    wb.store.approve(project.id, 'new-protection', runs[1].id, 'capture', 'durable-sha256');
    await expect(wb.cleanupRetention()).rejects.toThrow();
    expect(wb.store.run(runs[0].id)).toBeUndefined();
    expect(wb.store.run(runs[1].id)).toBeDefined();
    expect(wb.retentionState()).toMatchObject({
      pendingDeletions: 1,
      lastCleanup: { outcome: 'failed', deleted: 1 },
    });
  } finally {
    await wb.close();
    await rm(directory, { recursive: true, force: true });
  }
});
