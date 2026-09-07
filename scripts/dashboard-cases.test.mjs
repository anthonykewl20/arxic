import { expect, it } from 'vitest';

it('partitions every installed dashboard file exactly once and preserves full default coverage', async () => {
  const { installedDashboardCases } = await import('./dashboard-cases.mjs');
  const full = installedDashboardCases();
  const first = installedDashboardCases({ dashboardOnly: true, shard: '1' });
  const second = installedDashboardCases({ dashboardOnly: true, shard: '2' });
  expect(full).toHaveLength(16);
  expect(full).toContain('apps/web/src/__tests__/capture-write-isolation.real-world.test.ts');
  expect(full).toContain('apps/web/src/__tests__/visual-density-ui.real-world.test.ts');
  expect(full).toContain('apps/web/src/__tests__/contrast-ui.real-world.test.ts');
  expect(first.length).toBeGreaterThan(0);
  expect(second.length).toBeGreaterThan(0);
  expect([...first, ...second].sort()).toEqual([...full].sort());
  expect(new Set([...first, ...second]).size).toBe(full.length);
  expect(installedDashboardCases({ dashboardOnly: true })).toEqual(full);
});

it('refuses invalid or silently narrowed full-release shard selections', async () => {
  const { installedDashboardCases } = await import('./dashboard-cases.mjs');
  for (const shard of ['', '0', '3', '1/2', 'all', null, 1])
    expect(() => installedDashboardCases({ dashboardOnly: true, shard })).toThrow(
      'Invalid dashboard shard selection',
    );
  expect(() => installedDashboardCases({ shard: '1' })).toThrow(
    'Invalid dashboard shard selection',
  );
});

it('requires both exhaustive partitions for both installed non-Chromium browser gates', async () => {
  const { readFile } = await import('node:fs/promises');
  const { parse } = await import('yaml');
  const workflow = parse(await readFile('.github/workflows/ci.yml', 'utf8'));
  const job = workflow.jobs.dashboard;
  expect(job.strategy.matrix).toEqual({ browser: ['firefox', 'webkit'], shard: [1, 2] });
  expect(job.steps.find((step) => step.name === 'Installed dashboard journeys').run).toContain(
    '--dashboard-shard ${{ matrix.shard }}',
  );
  expect(
    job.steps.find((step) => step.name === 'Retain sanitized dashboard proof').with.name,
  ).toContain('${{ matrix.shard }}');
  expect(workflow.jobs.ci.needs).toContain('dashboard');
});

it('refuses missing and full-release shard arguments at the real CLI before installation', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  for (const args of [
    ['--dashboard-only', '--dashboard-shard'],
    ['--dashboard-shard', '1'],
  ]) {
    const result = await promisify(execFile)(
      process.execPath,
      ['scripts/human-flow-e2e.mjs', ...args],
      { timeout: 5000 },
    ).catch((error) => error);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      '--dashboard-shard requires --dashboard-only and a value of 1 or 2',
    );
  }
});
