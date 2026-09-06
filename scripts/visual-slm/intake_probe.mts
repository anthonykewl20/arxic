// Queue-pressure probe for the bounded intake service (refs #423, spec 13).
// Scope: admission + journal + queue mechanics under a constrained container,
// with a no-op executor — this isolates the service overhead and does NOT
// measure the analysis path (analysis_probe.mjs covers that). Expects /data
// with a valid case manifest and writes its scratch spool under /out.
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createIntakeQueue } from '/repo/apps/web/src/compact-visual/intake';

const dataCase = process.argv[2] ?? '/data/koel-360-clip-full.json';
const scratch = await mkdtemp('/out/intake-probe-');
const cgroup = async (file: string) => (await readFile(`/sys/fs/cgroup/${file}`, 'utf8')).trim();
const noop = async () => await new Promise((resolve) => setTimeout(resolve, 5));
try {
  const manifest = JSON.parse(await readFile(dataCase, 'utf8'));
  await copyFile(dataCase, `${scratch}/case.json`);
  for (let i = 1; i <= 6; i++)
    await writeFile(
      `${scratch}/probe-${i}.json`,
      JSON.stringify({ ...manifest, id: `probe-${i}` }),
    );

  // Idempotent re-submission of one pending case: every accept returns the
  // original id and the queue never grows past one job.
  const idempotent = createIntakeQueue({
    root: scratch,
    journalPath: `${scratch}/journal1.jsonl`,
    execute: noop,
  });
  const idempotentMs: number[] = [];
  for (let i = 0; i < 12; i++) {
    const started = performance.now();
    await idempotent.submit({ casePath: 'case.json' });
    idempotentMs.push(performance.now() - started);
  }
  await idempotent.settledIdle();
  const sameId = (await idempotent.submit({ casePath: 'case.json' })).accepted;

  // One active + four queued distinct jobs; the fifth submission backpressures.
  const queue = createIntakeQueue({
    root: scratch,
    journalPath: `${scratch}/journal2.jsonl`,
    execute: noop,
  });
  const active = await queue.submit({ casePath: 'probe-1.json' });
  await queue.waitForActive();
  const queued = [];
  for (let i = 2; i <= 5; i++) queued.push(await queue.submit({ casePath: `probe-${i}.json` }));
  // Sixth distinct case while four queue + one runs: must backpressure.
  const rejected = await queue.submit({ casePath: 'probe-6.json' });
  const drainStart = performance.now();
  await queue.settledIdle();

  // Deadline path: a 60 ms executor against a 10 ms budget fails open into a
  // recorded diagnostic while the queue itself keeps serving.
  const deadline = createIntakeQueue({
    root: scratch,
    journalPath: `${scratch}/journal3.jsonl`,
    deadlineMs: 10,
    execute: async () => await new Promise((resolve) => setTimeout(resolve, 60)),
  });
  await deadline.submit({ casePath: 'case.json' });
  await deadline.submit({ casePath: 'probe-1.json' });
  await deadline.settledIdle();

  idempotentMs.sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        scope: 'intake-admission-journal-queue-mechanics; no-op executor; not the analysis path',
        idempotentSubmissions: 12,
        idempotentAdmissionMsP50: idempotentMs[Math.floor(idempotentMs.length / 2)],
        idempotentSingleJob: sameId !== false,
        distinctAccepted: queued.filter((r) => r.accepted).length,
        backpressureReason: rejected.accepted ? null : rejected.reason,
        activeJobStarted: active.accepted,
        drainMsForFiveJobs: Math.round(performance.now() - drainStart),
        deadlineOutcomes: deadline.history().map((j) => `${j.state}:${j.diagnostic}`),
        memoryPeakBytes: Number(await cgroup('memory.peak')),
        memoryMax: await cgroup('memory.max'),
        cpuMax: await cgroup('cpu.max'),
        memoryEvents: await cgroup('memory.events'),
        vpsQualified: false,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
