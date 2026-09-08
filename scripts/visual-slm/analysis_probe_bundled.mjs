// Production-packaged runtime probe (refs #423, spec §13): measures the real
// review path through a plain-node bundle (no tsx/esbuild dev harness) under a
// constrained container. Expects /out/bt/review-bundle.mjs (built with the
// command in the README) with node_modules/sharp symlinked beside it, plus /out
// writable for the journal-free scratch. argv: CASE_PATH [jobs].
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const caseArg = process.argv[2] ?? '/data/koel-360-clip-full.json';
const jobs = Number(process.argv[3] ?? 10);
const root = caseArg.startsWith('/data/') ? '/data' : '/out/max-input-case';
const caseName = caseArg.split('/').pop();
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
    ['/out/bt/review-bundle.mjs', root, caseName, 'mlp-model.json', '/data/visual-native'],
    {
      encoding: 'utf8',
      timeout: 10000,
      // A 128-region review report exceeds 64 KiB; spawnSync kills the child
      // when stdout passes maxBuffer, which masqueraded as a timeout.
      maxBuffer: 4 * 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        ARXIC_VERSION: process.env.ARXIC_VERSION ?? '0.0.200',
      },
    },
  );
  if (child.status !== 0) {
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
  // Every shadow report must refuse overall pass; the real clip case must also
  // retain its deterministic hard failure. The synthetic bounds case carries no
  // failing checks by design, so only the pass-refusal applies there.
  const mustHoldHardFailure = caseName.includes('clip');
  if (
    report.overallPass !== false ||
    (mustHoldHardFailure && !report.hardChecks.some((c) => c.verdict === 'fail'))
  ) {
    failure = { jobsCompleted: times.length, reason: 'hard-failure-lost' };
    break;
  }
  times.push(performance.now() - started);
}
times.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      scope: 'bundled plain-node review (no tsx/esbuild at runtime); no browser/server/OS',
      runtime: 'node + review-bundle.mjs (esbuild-bundled, sharp external)',
      jobs: times.length,
      requestedJobs: jobs,
      case: caseName,
      failure,
      coldMs: times[0] ?? null,
      p50Ms: times.length
        ? (times[Math.floor((times.length - 1) / 2)] + times[Math.ceil((times.length - 1) / 2)]) / 2
        : null,
      p95Ms: times.length ? times[Math.floor((times.length - 1) * 0.95)] : null,
      memoryPeakBytes: Number(cgroup('memory.peak')),
      memoryMax: cgroup('memory.max'),
      cpuMax: cgroup('cpu.max'),
      memoryEvents: cgroup('memory.events'),
      vpsQualified: false,
    },
    null,
    2,
  ),
);
