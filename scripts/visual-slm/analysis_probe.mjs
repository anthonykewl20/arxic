// Linux cgroup probe for the actual read-only PNG -> features -> native -> report path.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const caseName = process.argv[2] ?? 'arxic-800-clipped.json';
const times = [];
for (let i = 0; i < 10; i++) {
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
  if (child.status !== 0)
    throw new Error(`analysis-process-failed:${child.status}:${child.stderr}`);
  const report = JSON.parse(child.stdout);
  if (report.overallPass !== false || !report.hardChecks.some((c) => c.verdict === 'fail'))
    throw new Error('hard-failure-lost');
  times.push(performance.now() - started);
}
const cgroup = (file) => readFileSync(`/sys/fs/cgroup/${file}`, 'utf8').trim();
times.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      scope: 'PNG-evidence-to-native-shadow-report plus Node driver; no browser/server/OS',
      jobs: times.length,
      case: caseName,
      processPerJob: true,
      p50Ms: (times[4] + times[5]) / 2,
      p95Ms: times[9],
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
