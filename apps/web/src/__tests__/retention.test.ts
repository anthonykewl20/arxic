import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Workbench } from '../workbench';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function open() {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-retention-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const wb = await Workbench.open(directory, [resolve(import.meta.dirname, '../../../..')]);
  cleanup.push(() => wb.close());
  return wb;
}
it('refuses cleanup by default and refuses invalid or unconfirmed automatic deletion policies', async () => {
  const wb = await open();
  expect(wb.retentionState().policy).toEqual({ enabled: false, maxAgeDays: 30, keepLatest: 20 });
  await expect(wb.cleanupRetention()).rejects.toThrow('disabled');
  for (const input of [
    null,
    {},
    { enabled: true, maxAgeDays: 30, keepLatest: 20 },
    { enabled: true, maxAgeDays: 0, keepLatest: 20, confirmDeletion: true },
    { enabled: false, maxAgeDays: 30, keepLatest: 0 },
    { enabled: false, maxAgeDays: 30, keepLatest: 20, unknown: true },
  ]) {
    await expect(wb.saveRetention(input as never)).rejects.toThrow();
  }
  expect(wb.retentionState().policy.enabled).toBe(false);
});
it('previews the whole persisted history with a bounded batch and explicit reference protections', async () => {
  const wb = await open();
  await wb.idle();
  const project = await wb.saveProject({ name: 'History boundary', folder: wb.roots[0] });
  // Database/history scale boundary supplements the actual-capture test; no browser proof is inferred here.
  const ids: string[] = [];
  for (let i = 0; i < 251; i++) {
    const run = wb.store.enqueue(project, 'discovery')!;
    ids.push(run.id);
    wb.store.saveRun({
      ...run,
      state: 'completed',
      createdAt: '2025-01-01T00:00:00.000Z',
      finishedAt: new Date(Date.UTC(2025, 0, 1, 0, 0, i)).toISOString(),
      result: { outcome: 'observed', summary: 'History fixture' },
    });
  }
  wb.store.approve(project.id, 'reference', ids[0], 'checkpoint-1');
  const reviewer = wb.store.run(ids[1])!;
  wb.store.saveRun({ ...reviewer, visualReview: { sourceRunId: ids[2] } as never });
  wb.store.saveCampaign({
    id: 'history-campaign',
    projectId: project.id,
    projectName: project.name,
    discoveryRunId: ids[3],
    sourceCommit: 'a'.repeat(40),
    createdAt: '2025-01-01T00:00:00.000Z',
    runIds: [ids[4]],
    rows: [],
  });
  const preview = wb.previewRetention({ enabled: false, maxAgeDays: 30, keepLatest: 1 });
  expect(wb.store.runs()).toHaveLength(200);
  expect(preview).toMatchObject({
    total: 251,
    candidateCount: 246,
    batchLimit: 50,
    protected: { baseline: 1, review: 1, campaign: 2, recent: 1 },
  });
  expect(preview.candidates).toHaveLength(50);
  expect(
    preview.candidates.some((row) => [ids[0], ids[2], ids[3], ids[4], ids[250]].includes(row.id)),
  ).toBe(false);
  await wb.saveRetention({ enabled: true, maxAgeDays: 30, keepLatest: 1, confirmDeletion: true });
  expect(await wb.cleanupRetention()).toMatchObject({ outcome: 'completed', deleted: 50 });
  expect(wb.previewRetention().total).toBe(201);
  for (const id of [ids[0], ids[2], ids[3], ids[4], ids[250]])
    expect(wb.store.run(id)).toBeDefined();
});
