import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { Workbench } from '../workbench';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
it('reclaims real evidence bytes over the disk quota while approved baselines stay byte-identical', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'web-retention-quota');
  cleanups.push(async () => {
    await stopApp(target.child);
    await rm(target.runtimeDirectory, { recursive: true, force: true });
  });
  const state = await mkdtemp(join(tmpdir(), 'arxic-retention-quota-real-'));
  cleanups.push(() => rm(state, { recursive: true, force: true }));
  const wb = await Workbench.open(state, [root]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({
    name: 'Quota reference app',
    folder: join(root, 'test-fixtures/vulnerable-auth-app'),
    origin: target.origin,
    viewports: [{ width: 800, height: 600 }],
    captureConsent: true,
  });
  const baseline = wb.enqueue(project.id, 'visual');
  await wb.idle();
  const capture = wb.store.run(baseline.id)!.result!.captures![0];
  await wb.approveBaseline(baseline.id, capture.id);
  const padded = wb.enqueue(project.id, 'visual');
  await wb.idle();
  const newest = wb.enqueue(project.id, 'visual');
  await wb.idle();
  // Persisted timestamps are the clock boundary; all images come from real Chromium captures.
  for (const [run, days] of [
    [baseline, 90],
    [padded, 2],
    [newest, 1],
  ] as const) {
    const stored = wb.store.run(run.id)!;
    wb.store.saveRun({
      ...stored,
      createdAt: new Date(Date.now() - days * 86400000).toISOString(),
      finishedAt: new Date(Date.now() - days * 86400000).toISOString(),
    });
  }
  await wb.saveRetention({
    enabled: true,
    maxAgeDays: 30,
    keepLatest: 1,
    confirmDeletion: true,
    diskQuotaMb: 1,
  });
  const quiet = await wb.previewRetention();
  expect(quiet.quota?.over).toBe(false);
  expect(quiet.quota?.candidates.map((row: { id: string }) => row.id)).toEqual([padded.id]);
  // Quota pressure fixture: a real file above the 1 MB limit inside the
  // candidate's own evidence directory (same injection precedent as the
  // failed-deletion journey in retention.real-world.test.ts).
  await mkdir(join(state, 'runs', padded.id), { recursive: true });
  await writeFile(join(state, 'runs', padded.id, 'oversized.bin'), Buffer.alloc(1_200_000));
  const preview = await wb.previewRetention();
  expect(preview.quota?.over).toBe(true);
  expect(preview.quota?.measuredBytes).toBeGreaterThan(1_048_576);
  const baselineBytes = (await wb.artifact(baseline.id, capture.file)).bytes;
  const result = await wb.cleanupRetention();
  expect(result).toMatchObject({ outcome: 'completed', deleted: 1, stillOverQuota: false });
  expect(wb.store.run(padded.id)).toBeUndefined();
  expect(wb.store.run(baseline.id)).toBeDefined();
  expect(wb.store.run(newest.id)).toBeDefined();
  await expect(readFile(join(state, 'runs', padded.id, 'oversized.bin'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  expect((await wb.artifact(baseline.id, capture.file)).bytes.equals(baselineBytes)).toBe(true);
  expect(
    wb.store.auditLog().some((row) => row.action === 'run.deleted' && row.subject === padded.id),
  ).toBe(true);
}, 120000);
