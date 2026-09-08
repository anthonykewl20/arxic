import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Workbench } from '../workbench';
import { digest } from '../visual';
import type { Project, Run } from '../types';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * Seeds a completed visual run with one real capture file on disk. The run row is
 * created through the public store API (enqueue + saveRun); the capture bytes are
 * real and hashed, so the approval integrity gate exercises the real digest path.
 */
async function seedCompletedVisualRun(
  wb: Workbench,
  project: Project,
  stateDirectory: string,
  bytes: Buffer,
  specHash: string,
  status: 'needs-baseline' | 'unchanged' | 'unstable',
  id: string,
) {
  const queued = wb.store.enqueue(project, 'visual')!;
  const capture = {
    id,
    path: '/',
    viewport: { width: 800, height: 600 },
    file: `${id}.png`,
    sha256: digest(bytes),
    specHash,
    browserVersion: '131.0.0.0',
    status,
  };
  const run: Run = {
    ...queued,
    state: 'completed',
    finishedAt: new Date().toISOString(),
    result: { outcome: 'observed', summary: 'Seeded capture fixture', captures: [capture] },
  };
  wb.store.saveRun(run);
  await mkdir(join(stateDirectory, 'runs', run.id), { recursive: true });
  await writeFile(join(stateDirectory, 'runs', run.id, capture.file), bytes, { mode: 0o600 });
  return { run, capture };
}

async function openWorkbench() {
  const state = await mkdtemp(join(tmpdir(), 'arxic-baseline-ledger-'));
  cleanups.push(() => rm(state, { recursive: true, force: true }));
  const wb = await Workbench.open(state, [state]);
  cleanups.push(() => wb.close());
  const project = await wb.saveProject({ name: 'Ledger project', folder: state });
  return { wb, project, state };
}

const SPEC = 'spec-hash-a';

it('appends immutable attributable approval rows, supersedes without rewriting history, and keeps the pointer at the chain head', async () => {
  const { wb, project, state } = await openWorkbench();
  const first = await seedCompletedVisualRun(
    wb,
    project,
    state,
    Buffer.from('first capture bytes'),
    SPEC,
    'needs-baseline',
    'checkpoint-1',
  );
  const second = await seedCompletedVisualRun(
    wb,
    project,
    state,
    Buffer.from('second capture bytes'),
    SPEC,
    'unchanged',
    'checkpoint-1',
  );
  await wb.approveBaseline(first.run.id, first.capture.id);
  const firstEntry = wb
    .state()
    .baselineApprovals.filter((entry) => entry.kind === 'approval')
    .at(-1)!;
  expect(firstEntry).toMatchObject({
    kind: 'approval',
    projectId: project.id,
    spec: SPEC,
    runId: first.run.id,
    captureId: first.capture.id,
    captureSha256: first.capture.sha256,
    approvedBy: 'administrator',
    supersedes: null,
  });
  expect(new Date(firstEntry.approvedAt!).toString()).not.toBe('Invalid Date');

  await wb.approveBaseline(second.run.id, second.capture.id);
  const approvals = wb.state().baselineApprovals.filter((entry) => entry.kind === 'approval');
  expect(approvals).toHaveLength(2);
  expect(approvals[0]).toEqual(firstEntry); // the earlier row is never mutated
  expect(approvals[1]).toMatchObject({
    runId: second.run.id,
    supersedes: approvals[0].id,
  });
  expect(wb.store.baseline(project.id, SPEC)?.run_id).toBe(second.run.id);
});

it('serializes concurrent approvals into one pointer with a linear supersedes chain', async () => {
  const { wb, project, state } = await openWorkbench();
  const seeded = [];
  for (const index of [1, 2, 3]) {
    seeded.push(
      await seedCompletedVisualRun(
        wb,
        project,
        state,
        Buffer.from(`capture ${index}`),
        SPEC,
        'needs-baseline',
        `checkpoint-${index}`,
      ),
    );
  }
  await Promise.all(seeded.map((item) => wb.approveBaseline(item.run.id, item.capture.id)));
  const approvals = wb.state().baselineApprovals.filter((entry) => entry.kind === 'approval');
  expect(approvals).toHaveLength(3);
  expect(approvals[0].supersedes).toBeNull();
  expect(approvals[1].supersedes).toBe(approvals[0].id);
  expect(approvals[2].supersedes).toBe(approvals[1].id);
  const pointer = wb.store.baseline(project.id, SPEC)!;
  expect(pointer.run_id).toBe(approvals[2].runId);
});

it('refuses deletion of a run referenced only by a superseded approval', async () => {
  const { wb, project, state } = await openWorkbench();
  const first = await seedCompletedVisualRun(
    wb,
    project,
    state,
    Buffer.from('superseded bytes'),
    SPEC,
    'needs-baseline',
    'checkpoint-1',
  );
  const second = await seedCompletedVisualRun(
    wb,
    project,
    state,
    Buffer.from('current bytes'),
    SPEC,
    'unchanged',
    'checkpoint-1',
  );
  await wb.approveBaseline(first.run.id, first.capture.id);
  await wb.approveBaseline(second.run.id, second.capture.id);
  expect(wb.store.baseline(project.id, SPEC)?.run_id).toBe(second.run.id);
  await expect(wb.deleteRun(first.run.id)).rejects.toThrow('approved baselines');
  expect(wb.store.run(first.run.id)).toBeDefined();
});

it('labels pre-ledger pointer rows as legacy without fabricating an approver or timestamp', async () => {
  const { wb, project, state } = await openWorkbench();
  // Simulate a database written before the ledger existed: a pointer row with no
  // approval record. The migration path must expose it honestly.
  wb.store.db
    .prepare('INSERT INTO baselines VALUES (?, ?, ?, ?)')
    .run(project.id, 'legacy-spec', 'legacy-run-id', 'legacy-capture-id');
  const legacy = wb.state().baselineApprovals.find((entry) => entry.spec === 'legacy-spec');
  expect(legacy).toMatchObject({
    kind: 'legacy',
    projectId: project.id,
    runId: 'legacy-run-id',
    captureId: 'legacy-capture-id',
  });
  // No fabricated provenance: the union's legacy variant carries neither field.
  expect(legacy).not.toHaveProperty('approvedBy');
  expect(legacy).not.toHaveProperty('approvedAt');

  const seeded = await seedCompletedVisualRun(
    wb,
    project,
    state,
    Buffer.from('post-ledger bytes'),
    'legacy-spec',
    'needs-baseline',
    'checkpoint-1',
  );
  await wb.approveBaseline(seeded.run.id, seeded.capture.id);
  // An attributable approval replaces the unknown-provenance pointer; the legacy
  // marker only exists while no ledger row covers the spec.
  const entries = wb.state().baselineApprovals.filter((entry) => entry.spec === 'legacy-spec');
  expect(entries).toEqual([
    expect.objectContaining({
      kind: 'approval',
      runId: seeded.run.id,
      supersedes: null,
    }),
  ]);
});

it('keeps the integrity gates fail-closed and the ledger empty on refused approvals', async () => {
  const { wb, project, state } = await openWorkbench();
  const tampered = await seedCompletedVisualRun(
    wb,
    project,
    state,
    Buffer.from('actual bytes'),
    SPEC,
    'needs-baseline',
    'checkpoint-1',
  );
  await writeFile(
    join(state, 'runs', tampered.run.id, tampered.capture.file),
    Buffer.from('tampered bytes'),
    { mode: 0o600 },
  );
  await expect(wb.approveBaseline(tampered.run.id, tampered.capture.id)).rejects.toThrow(
    'integrity',
  );
  const unstable = await seedCompletedVisualRun(
    wb,
    project,
    state,
    Buffer.from('unstable bytes'),
    SPEC,
    'unstable',
    'checkpoint-2',
  );
  await expect(wb.approveBaseline(unstable.run.id, unstable.capture.id)).rejects.toThrow(
    'Only a completed, stable capture',
  );
  const queued = wb.store.enqueue(project, 'visual')!;
  await expect(wb.approveBaseline(queued.id, 'checkpoint-1')).rejects.toThrow(
    'Only a completed, stable capture',
  );
  await expect(wb.approveBaseline(randomUUID(), 'checkpoint-1')).rejects.toThrow(
    'Only a completed, stable capture',
  );
  expect(wb.state().baselineApprovals.filter((entry) => entry.kind === 'approval')).toHaveLength(0);
});
