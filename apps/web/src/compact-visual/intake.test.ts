import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createIntakeQueue, loadJournal } from './intake';

const directory = async () => mkdtemp(join(tmpdir(), 'visual-intake-'));

it('admits at most one active and four queued jobs; the fifth submission gets backpressure with stable IDs', async () => {
  const dir = await directory();
  try {
    const manifest = (name: string, inner: string) => ({
      version: 1,
      id: inner,
      group: 'g',
      revision: 'a'.repeat(40),
      consent: true,
      context: { width: 800, height: 600, dpr: 1, profile: 'p', state: 's' },
      before: { path: 'b.png', sha256: '0'.repeat(64) },
      current: { path: 'c.png', sha256: '0'.repeat(64) },
      beforePrivacy: { path: 'bp.json', sha256: '0'.repeat(64) },
      currentPrivacy: { path: 'cp.json', sha256: '0'.repeat(64) },
      scene: { path: 's.json', sha256: '0'.repeat(64) },
      timeline: { path: 't.json', sha256: '0'.repeat(64) },
      timelineProvenance: { path: 'tp.json', sha256: '0'.repeat(64) },
    });
    for (let i = 1; i <= 6; i++)
      await writeFile(
        join(dir, `case${i}.json`),
        JSON.stringify(manifest(`case${i}`, `case-${i}`)),
      );
    const casePath = 'case1.json';
    const started: string[] = [];
    let release: (() => void) | undefined;
    const queue = createIntakeQueue({
      root: dir,
      execute: async (job) => {
        started.push(job.id);
        // Only the first job parks; later jobs must flow once it releases.
        if (started.length === 1) await new Promise<void>((r) => (release = r));
        return { reviewed: job.id };
      },
    });
    const first = await queue.submit({ casePath });
    expect(first.accepted).toBe(true);
    await queue.waitForActive();
    const queued = [];
    for (let i = 2; i <= 5; i++) queued.push(await queue.submit({ casePath: `case${i}.json` }));
    expect(queued.every((r) => r.accepted)).toBe(true);
    const fifth = await queue.submit({ casePath: 'case6.json' });
    expect(fifth).toMatchObject({ accepted: false, reason: 'backpressure' });
    expect(started).toHaveLength(1);
    // Accepted jobs keep stable ids; the rejected fifth never consumed one's slot.
    expect(new Set(queued.map((q) => q.id)).size).toBe(4);
    release!();
    await queue.settledIdle();
    expect(started.length).toBeGreaterThan(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('rejects admission for invalid, oversized or traversal manifests without consuming a queue slot', async () => {
  const dir = await directory();
  try {
    await writeFile(join(dir, 'broken.json'), '{not json');
    await writeFile(join(dir, 'case.json'), JSON.stringify({ version: 1 }));
    const queue = createIntakeQueue({ root: dir, execute: async () => ({}) });
    await expect(queue.submit({ casePath: 'broken.json' })).resolves.toMatchObject({
      accepted: false,
      reason: 'invalid-case',
    });
    await expect(queue.submit({ casePath: 'case.json' })).resolves.toMatchObject({
      accepted: false,
      reason: 'invalid-case',
    });
    await expect(queue.submit({ casePath: '../escape.json' })).resolves.toMatchObject({
      accepted: false,
      reason: 'unsafe-path',
    });
    // No slot was consumed by rejections: four admissions still fit.
    await writeFile(
      join(dir, 'ok.json'),
      JSON.stringify({
        version: 1,
        id: 'case-ok',
        group: 'g',
        revision: 'a'.repeat(40),
        consent: true,
        context: { width: 800, height: 600, dpr: 1, profile: 'p', state: 's' },
        before: { path: 'b.png', sha256: '0'.repeat(64) },
        current: { path: 'c.png', sha256: '0'.repeat(64) },
        beforePrivacy: { path: 'bp.json', sha256: '0'.repeat(64) },
        currentPrivacy: { path: 'cp.json', sha256: '0'.repeat(64) },
        scene: { path: 's.json', sha256: '0'.repeat(64) },
        timeline: { path: 't.json', sha256: '0'.repeat(64) },
        timelineProvenance: { path: 'tp.json', sha256: '0'.repeat(64) },
      }),
    );
    const admitted = [];
    for (let i = 0; i < 4; i++) admitted.push(await queue.submit({ casePath: 'ok.json' }));
    expect(admitted.every((r) => r.accepted)).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('fails a job that exceeds the analysis deadline and keeps serving the queue', async () => {
  const dir = await directory();
  try {
    const manifestFor = (inner: string) => ({
      version: 1,
      id: inner,
      group: 'g',
      revision: 'a'.repeat(40),
      consent: true,
      context: { width: 800, height: 600, dpr: 1, profile: 'p', state: 's' },
      before: { path: 'b.png', sha256: '0'.repeat(64) },
      current: { path: 'c.png', sha256: '0'.repeat(64) },
      beforePrivacy: { path: 'bp.json', sha256: '0'.repeat(64) },
      currentPrivacy: { path: 'cp.json', sha256: '0'.repeat(64) },
      scene: { path: 's.json', sha256: '0'.repeat(64) },
      timeline: { path: 't.json', sha256: '0'.repeat(64) },
      timelineProvenance: { path: 'tp.json', sha256: '0'.repeat(64) },
    });
    await writeFile(join(dir, 'slow.json'), JSON.stringify(manifestFor('case-slow')));
    await writeFile(join(dir, 'fast.json'), JSON.stringify(manifestFor('case-fast')));
    const done: string[] = [];
    const queue = createIntakeQueue({
      root: dir,
      deadlineMs: 30,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      execute: async (job) => {
        if (job.id.endsWith('1')) await new Promise((r) => setTimeout(r, 500));
        done.push(job.id);
        return {};
      },
    });
    const slow = await queue.submit({ casePath: 'slow.json' });
    const fast = await queue.submit({ casePath: 'fast.json' });
    await queue.settledIdle();
    expect([slow.accepted, fast.accepted]).toEqual([true, true]);
    const slowJob = queue.history().find((j) => j.id === slow.id)!;
    expect(slowJob.state).toBe('failed');
    expect(slowJob.diagnostic).toBe('deadline-exceeded');
    const fastJob = queue.history().find((j) => j.id === fast.id)!;
    expect(fastJob.state).toBe('complete');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const validManifestPath = async (dir: string) => {
  const manifest = {
    version: 1,
    id: 'case',
    group: 'g',
    revision: 'a'.repeat(40),
    consent: true,
    context: { width: 800, height: 600, dpr: 1, profile: 'p', state: 's' },
    before: { path: 'b.png', sha256: '0'.repeat(64) },
    current: { path: 'c.png', sha256: '0'.repeat(64) },
    beforePrivacy: { path: 'bp.json', sha256: '0'.repeat(64) },
    currentPrivacy: { path: 'cp.json', sha256: '0'.repeat(64) },
    scene: { path: 's.json', sha256: '0'.repeat(64) },
    timeline: { path: 't.json', sha256: '0'.repeat(64) },
    timelineProvenance: { path: 'tp.json', sha256: '0'.repeat(64) },
  };
  await writeFile(join(dir, 'case.json'), JSON.stringify(manifest));
  return 'case.json';
};

it('recovers interrupted jobs from the journal after a crash without duplicate admission', async () => {
  const dir = await directory();
  try {
    await validManifestPath(dir);
    const manifestFor = (kind: string) => ({
      version: 1,
      id: `case-${kind}`,
      group: 'g',
      revision: 'a'.repeat(40),
      consent: true,
      context: { width: 800, height: 600, dpr: 1, profile: 'p', state: 's' },
      before: { path: 'b.png', sha256: '0'.repeat(64) },
      current: { path: 'c.png', sha256: '0'.repeat(64) },
      beforePrivacy: { path: 'bp.json', sha256: '0'.repeat(64) },
      currentPrivacy: { path: 'cp.json', sha256: '0'.repeat(64) },
      scene: { path: 's.json', sha256: '0'.repeat(64) },
      timeline: { path: 't.json', sha256: '0'.repeat(64) },
      timelineProvenance: { path: 'tp.json', sha256: '0'.repeat(64) },
    });
    await writeFile(join(dir, 'case-a.json'), JSON.stringify(manifestFor('a')));
    await writeFile(join(dir, 'case-b.json'), JSON.stringify(manifestFor('b')));
    const first = createIntakeQueue({
      root: dir,
      journalPath: join(dir, 'journal.jsonl'),
      // Parked forever: the crash leaves admitted/started entries with no terminals.
      execute: async () => new Promise(() => {}),
    });
    const a = await first.submit({ casePath: 'case-a.json' });
    const b = await first.submit({ casePath: 'case-b.json' });
    await first.waitForActive();

    const second = createIntakeQueue({
      root: dir,
      journalPath: join(dir, 'journal.jsonl'),
      execute: async () => ({}),
    });
    const interrupted = second
      .history()
      .filter((j) => j.state === 'queued' || j.state === 'active');
    expect(interrupted.map((j) => j.id).sort()).toEqual([a.id, b.id].sort());
    // Re-submitting a still-pending case is idempotent: the original id returns.
    const again = await second.submit({ casePath: 'case-a.json' });
    expect(again).toMatchObject({ accepted: true, id: a.id });
    await second.settledIdle();
    expect(second.history().every((j) => j.state === 'complete' || j.state === 'failed')).toBe(
      true,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('tolerates a torn final journal line but rejects corruption in the middle', async () => {
  const dir = await directory();
  try {
    const journal = join(dir, 'journal.jsonl');
    const torn = [
      JSON.stringify({ type: 'admitted', id: 'job-x-1', casePath: 'case.json', submittedAt: 1 }),
      '{"type":"admitted","id":"job-x-2","casePa',
    ].join('\n');
    await writeFile(journal, torn);
    const state = loadJournal(journal);
    expect(state.history.map((j) => j.id)).toEqual([]);
    expect(state.interrupted.map((j) => j.id)).toEqual(['job-x-1']);
    expect(state.tornTailEntries).toBe(1);

    const corrupted = [
      JSON.stringify({ type: 'admitted', id: 'job-x-1', casePath: 'case.json', submittedAt: 1 }),
      '{"type":"admitted","id":"broken',
      JSON.stringify({ type: 'terminal', id: 'job-x-1', state: 'complete', diagnostic: null }),
    ].join('\n');
    await writeFile(journal, corrupted);
    expect(() => loadJournal(journal)).toThrow('journal-corrupt');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
