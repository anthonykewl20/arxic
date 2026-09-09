import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
it('keeps failed deletion visible, recovers its durable intent, and preserves actual baseline evidence', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'web-retention');
  cleanups.push(async () => {
    await stopApp(target.child);
    await rm(target.runtimeDirectory, { recursive: true, force: true });
  });
  const state = await mkdtemp(join(tmpdir(), 'arxic-retention-real-'));
  cleanups.push(() => rm(state, { recursive: true, force: true }));
  let wb = await Workbench.open(state, [root]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({
    name: 'Retention reference app',
    folder: join(root, 'test-fixtures/vulnerable-auth-app'),
    origin: target.origin,
    viewports: [{ width: 800, height: 600 }],
    captureConsent: true,
  });
  const baseline = wb.enqueue(project.id, 'visual');
  await wb.idle();
  const capture = wb.store.run(baseline.id)!.result!.captures![0];
  await wb.approveBaseline(baseline.id, capture.id);
  const candidate = wb.enqueue(project.id, 'visual');
  await wb.idle();
  const newest = wb.enqueue(project.id, 'visual');
  await wb.idle();
  expect(wb.store.run(candidate.id)?.result?.captures?.[0].status).toBe('unchanged');
  // Persisted timestamps are the clock boundary; all images come from real Chromium captures.
  for (const [run, days] of [
    [baseline, 62],
    [candidate, 61],
    [newest, 60],
  ] as const) {
    const stored = wb.store.run(run.id)!;
    wb.store.saveRun({
      ...stored,
      createdAt: new Date(Date.now() - days * 86400000).toISOString(),
      finishedAt: new Date(Date.now() - days * 86400000).toISOString(),
    });
  }
  const policy = { enabled: true, maxAgeDays: 30, keepLatest: 1, confirmDeletion: true };
  await wb.saveRetention(policy);
  const preview = await wb.previewRetention();
  expect(preview.candidates.map((row: { id: string }) => row.id)).toEqual([candidate.id]);
  expect(preview.protected.baseline).toBe(1);
  expect(preview.protected.recent).toBe(1);
  const baselineBytes = (await wb.artifact(baseline.id, capture.file)).bytes;
  const evidenceRoot = join(state, 'runs'),
    backup = join(state, 'runs-backup');
  await rename(evidenceRoot, backup);
  await writeFile(evidenceRoot, 'not a directory');
  await expect(wb.cleanupRetention()).rejects.toThrow('cleanup');
  expect(wb.retentionState()).toMatchObject({
    pendingDeletions: 1,
    lastCleanup: { outcome: 'failed' },
  });
  expect(wb.store.run(candidate.id)).toBeDefined();
  await rm(evidenceRoot);
  await rename(backup, evidenceRoot);
  await wb.close();
  wb = await Workbench.open(state, [root]);
  expect(wb.retentionState().policy).toEqual({
    enabled: true,
    maxAgeDays: 30,
    keepLatest: 1,
    diskQuotaMb: 0,
  });
  expect(wb.retentionState().pendingDeletions).toBe(0);
  expect(wb.store.run(candidate.id)).toBeUndefined();
  expect(wb.store.run(newest.id)).toBeDefined();
  expect((await wb.artifact(baseline.id, capture.file)).bytes.equals(baselineBytes)).toBe(true);
  await expect(readFile(join(state, 'runs', candidate.id, capture.file))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  expect(
    wb.store.auditLog().some((row) => row.action === 'run.deleted' && row.subject === candidate.id),
  ).toBe(true);
  const latest = wb.enqueue(project.id, 'visual');
  await wb.idle();
  wb.tick(new Date(Date.now() + 61_000));
  await wb.idle();
  expect(wb.store.run(newest.id)).toBeUndefined();
  expect(wb.store.run(latest.id)).toBeDefined();
  expect((await wb.artifact(baseline.id, capture.file)).bytes.equals(baselineBytes)).toBe(true);
}, 120000);
