import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const workflow = parse(
  await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'),
);
const gate = workflow.jobs.ci;
const gateScript = gate.steps.find((step) => step.run)?.run;
const passing = {
  ...process.env,
  STATIC: 'success',
  TEST: 'success',
  FIXTURE_APPS: 'success',
  PACKAGE: 'success',
  CHANGES: 'success',
  WORKER_REQUIRED: 'true',
  WORKER_IMAGE: 'success',
};

describe('required CI merge gate (refs #398)', () => {
  it('waits for worker change detection and the worker image check', () => {
    expect(gate.needs).toEqual(expect.arrayContaining(['changes', 'worker-image']));
  });

  it.each(['failure', 'cancelled', 'skipped'])(
    'rejects a required worker image result of %s',
    (result) => {
      expect(() =>
        execFileSync('bash', ['-c', gateScript], {
          env: { ...passing, WORKER_IMAGE: result },
          stdio: 'pipe',
        }),
      ).toThrow();
    },
  );

  it('accepts a deliberately unneeded worker image', () => {
    expect(() =>
      execFileSync('bash', ['-c', gateScript], {
        env: { ...passing, WORKER_REQUIRED: 'false', WORKER_IMAGE: 'skipped' },
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});

it('release publication waits for every supported OS/Node cell', async () => {
  const release = parse(
    await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'),
  );
  const matrix = parse(
    await readFile(new URL('../.github/workflows/release-test.yml', import.meta.url), 'utf8'),
  );
  expect(release.jobs.release.needs).toContain('release-test');
  expect(release.jobs['release-test'].uses).toBe('./.github/workflows/release-test.yml');
  expect(matrix.on).toHaveProperty('workflow_call');
});
