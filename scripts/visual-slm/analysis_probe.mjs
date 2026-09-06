// Linux cgroup probe for the actual read-only PNG -> features -> native -> report path.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const caseName = process.argv[2] ?? 'arxic-800-clipped.json';
const jobs = Number(process.argv[3] ?? 10);
const times = [];
const cgroup = (file) => {
  try {
    return readFileSync(`/sys/fs/cgroup/${file}`, 'utf8').trim();
  } catch {
    return null;
  }
};
let failure = null;
for (let i = 0; i < jobs; i++) {
  const started = performance.now();
  const child = spawnSync(
    process.execPath,
    [
      '/repo/apps/web/node_modules/tsx/dist/cli.mjs',
      '/repo/apps/web/src/compact-visual/cli.ts',
      'review',
      '/data',
      caseName,
      'mlp-model.json',
      '/data/visual-native',
    ],
    {
      cwd: '/repo',
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 65536,
      env: { PATH: process.env.PATH, TSX_DISABLE_CACHE: '1' },
    },
  );
  if (child.status !== 0) {
    // Sustained-load failures are findings, not crashes: retain where the
    // ceiling hit and the cgroup state at that moment.
    failure = {
      jobsCompleted: times.length,
      childStatus: child.status,
      childSignal: child.signal,
      stderr: (child.stderr ?? '').split('\n').slice(0, 6),
      pidsCurrent: cgroup('pids.current'),
      pidsMax: cgroup('pids.max'),
    };
    break;
  }
  const report = JSON.parse(child.stdout);
  if (report.overallPass !== false || !report.hardChecks.some((c) => c.verdict === 'fail')) {
    failure = { jobsCompleted: times.length, reason: 'hard-failure-lost' };
    break;
  }
  times.push(performance.now() - started);
}
times.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      scope: 'PNG-evidence-to-native-shadow-report plus Node driver; no browser/server/OS',
      jobs: times.length,
      requestedJobs: jobs,
      failure,
      case: caseName,
      processPerJob: true,
      coldMs: times[0],
      p50Ms: (times[Math.floor((times.length - 1) / 2)] + times[Math.ceil((times.length - 1) / 2)]) / 2,
      p95Ms: times[Math.floor((times.length - 1) * 0.95)],
      memoryPeakBytes: Number(cgroup('memory.peak')),
      memoryMax: cgroup('memory.max'),
      swapMax: cgroup('memory.swap.max'),
      cpuMax: cgroup('cpu.max'),
      memoryEvents: cgroup('memory.events'),
      vpsQualified: false,
    },
    null,
    2,
  ),
);
