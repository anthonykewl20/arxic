import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Workbench } from '../workbench';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function open() {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-retention-quota-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const wb = await Workbench.open(directory, [resolve(import.meta.dirname, '../../../..')]);
  cleanup.push(() => wb.close());
  return { wb, directory };
}
const KB = 1024;
async function seedRun(
  wb: Workbench,
  directory: string,
  project: { id: string },
  finishedAt: string,
  bytes = 0,
): Promise<string> {
  const run = wb.store.enqueue(project as never, 'discovery')!;
  wb.store.saveRun({
    ...run,
    state: 'completed',
    createdAt: finishedAt,
    finishedAt,
    result: { outcome: 'observed', summary: 'Quota fixture' },
  });
  if (bytes > 0) {
    await mkdir(join(directory, 'runs', run.id), { recursive: true });
    await writeFile(join(directory, 'runs', run.id, 'capture.png'), Buffer.alloc(bytes));
  }
  return run.id;
}
it('defaults the quota to disabled, validates it, and round-trips it', async () => {
  const { wb } = await open();
  expect(wb.retentionState().policy).toEqual({
    enabled: false,
    maxAgeDays: 30,
    keepLatest: 20,
    diskQuotaMb: 0,
  });
  for (const quota of [-1, 1.5, '5', 2_000_000, null]) {
    await expect(
      wb.saveRetention({
        enabled: false,
        maxAgeDays: 30,
        keepLatest: 20,
        diskQuotaMb: quota,
      } as never),
    ).rejects.toThrow('quota');
  }
  await wb.saveRetention({ enabled: false, maxAgeDays: 30, keepLatest: 20, diskQuotaMb: 512 });
  expect(wb.retentionState().policy).toEqual({
    enabled: false,
    maxAgeDays: 30,
    keepLatest: 20,
    diskQuotaMb: 512,
  });
  await wb.saveRetention({ enabled: false, maxAgeDays: 30, keepLatest: 20 });
  expect(wb.retentionState().policy).toEqual({
    enabled: false,
    maxAgeDays: 30,
    keepLatest: 20,
    diskQuotaMb: 0,
  });
});
it('accounts quota pressure from real evidence bytes without touching the age candidates', async () => {
  const { wb, directory } = await open();
  await wb.idle();
  const project = await wb.saveProject({ name: 'Quota history', folder: wb.roots[0] });
  const old = new Date(Date.now() - 90 * 86400000).toISOString();
  const young = new Date(Date.now() - 2 * 86400000).toISOString();
  const oldest = await seedRun(wb, directory, project, old);
  const baseline = await seedRun(wb, directory, project, old);
  const middle = await seedRun(wb, directory, project, young, 100 * KB);
  const newest = await seedRun(wb, directory, project, young, 100 * KB);
  wb.store.approve(project.id, 'reference', baseline, 'checkpoint-1', 'quota-sha256');
  await wb.saveRetention({ enabled: true, maxAgeDays: 30, keepLatest: 1, confirmDeletion: true });
  expect((await wb.previewRetention()).quota).toBeUndefined();
  const preview = await wb.previewRetention({
    enabled: true,
    maxAgeDays: 30,
    keepLatest: 1,
    diskQuotaMb: 1,
  });
  expect(preview.candidates.map((row: { id: string }) => row.id)).toEqual([oldest]);
  expect(preview.quota).toMatchObject({
    limitMb: 1,
    over: false,
    candidates: [{ id: middle }],
  });
  // Quota pressure only exists once real bytes exceed the limit.
  await writeFile(join(directory, 'runs', middle, 'capture.png'), Buffer.alloc(1200 * KB));
  const over = await wb.previewRetention({
    enabled: true,
    maxAgeDays: 30,
    keepLatest: 1,
    diskQuotaMb: 1,
  });
  expect(over.quota?.over).toBe(true);
  expect(over.quota?.measuredBytes).toBeGreaterThan(1024 * KB);
  // Protected and recent rows never become quota candidates; age candidates stay exclusive.
  expect(over.quota?.candidates.map((row: { id: string }) => row.id)).toEqual([middle]);
  expect(over.quota?.candidates.some((row: { id: string }) => row.id === baseline)).toBe(false);
  expect(over.quota?.candidates.some((row: { id: string }) => row.id === newest)).toBe(false);
});
it('deletes quota candidates oldest-first and reports honestly when protection keeps it over quota', async () => {
  const { wb, directory } = await open();
  await wb.idle();
  const project = await wb.saveProject({ name: 'Quota cleanup', folder: wb.roots[0] });
  const older = new Date(Date.now() - 3 * 86400000).toISOString();
  const younger = new Date(Date.now() - 2 * 86400000).toISOString();
  const first = await seedRun(wb, directory, project, older, 600 * KB);
  const second = await seedRun(wb, directory, project, younger, 600 * KB);
  await wb.saveRetention({
    enabled: true,
    maxAgeDays: 30,
    keepLatest: 1,
    confirmDeletion: true,
    diskQuotaMb: 1,
  });
  const result = await wb.cleanupRetention();
  expect(result).toMatchObject({ outcome: 'completed', deleted: 1, stillOverQuota: false });
  expect(wb.store.run(second)).toBeDefined();
  expect(wb.store.run(first)).toBeUndefined();
  const guarded = await open();
  await guarded.wb.idle();
  const project2 = await guarded.wb.saveProject({
    name: 'Quota guarded',
    folder: guarded.wb.roots[0],
  });
  const stamp = new Date(Date.now() - 90 * 86400000).toISOString();
  const protectedRun = await seedRun(guarded.wb, guarded.directory, project2, stamp, 1100 * KB);
  guarded.wb.store.approve(project2.id, 'reference', protectedRun, 'checkpoint-1', 'quota-guard');
  await guarded.wb.saveRetention({
    enabled: true,
    maxAgeDays: 30,
    keepLatest: 1,
    confirmDeletion: true,
    diskQuotaMb: 1,
  });
  expect((await guarded.wb.previewRetention()).quota?.over).toBe(true);
  expect((await guarded.wb.previewRetention()).quota?.candidates).toEqual([]);
  const honest = await guarded.wb.cleanupRetention();
  expect(honest).toMatchObject({ outcome: 'completed', deleted: 0, stillOverQuota: true });
  expect(guarded.wb.store.run(protectedRun)).toBeDefined();
  expect((await stat(join(guarded.directory, 'runs', protectedRun))).isDirectory()).toBe(true);
});
