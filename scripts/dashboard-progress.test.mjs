import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('retains bounded real Vitest case outcomes without names, assertion values or exception bodies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-progress-'));
  const output = join(directory, 'progress.jsonl');
  const secret = 'private-name-and-exception-canary';
  try {
    await writeFile(
      join(directory, 'vitest.config.mjs'),
      'export default {test:{include:["sample.test.mjs"]}};',
    );
    await writeFile(
      join(directory, 'sample.test.mjs'),
      `import {it,expect} from ${JSON.stringify(pathToFileURL(resolve('node_modules/vitest/dist/index.js')).href)};\nit(${JSON.stringify(secret)},()=>expect(${JSON.stringify(secret)}).toBe('different'));\nit('ordinary pass',()=>expect(1).toBe(1));\n`,
    );
    const result = await promisify(execFile)(
      process.execPath,
      [
        resolve('node_modules/vitest/vitest.mjs'),
        'run',
        '--config',
        join(directory, 'vitest.config.mjs'),
        '--reporter',
        resolve('scripts/dashboard-progress-reporter.mjs'),
      ],
      {
        cwd: directory,
        env: { ...process.env, ARXIC_DASHBOARD_PROGRESS_PATH: output },
        timeout: 20000,
      },
    ).catch((error) => error);
    expect(result.code).toBe(1);
    const bytes = await readFile(output, 'utf8');
    expect(bytes).not.toContain(secret);
    expect(bytes).not.toContain(directory);
    const rows = bytes
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(rows.filter((row) => row.event === 'case-start')).toHaveLength(2);
    expect(rows.filter((row) => row.event === 'case-result').map((row) => row.state)).toEqual([
      'failed',
      'passed',
    ]);
    expect(rows.find((row) => row.event === 'case-result' && row.state === 'failed')).toMatchObject(
      { failureKind: 'assertion' },
    );
    expect(
      rows.find((row) => row.event === 'case-result' && row.state === 'failed').failureLine,
    ).toBeGreaterThan(0);
    expect(rows.at(-1)).toMatchObject({ event: 'run-end', reason: 'failed' });
    for (const row of rows)
      expect(
        Object.keys(row).every((key) =>
          [
            'event',
            'elapsedMs',
            'file',
            'caseId',
            'line',
            'state',
            'reason',
            'failureKind',
            'failureLine',
            'reportedTimeoutMs',
          ].includes(key),
        ),
      ).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

it('records a real timed-out child without retaining its command or output', async () => {
  const { commandFailureFacts } = await import('./command-failure.mjs');
  const failure = await promisify(execFile)(
    process.execPath,
    ['-e', 'console.error("private-process-canary");setTimeout(()=>{},3000)'],
    { timeout: 100 },
  ).catch((error) => error);
  const facts = commandFailureFacts(failure);
  expect(facts).toEqual({ code: null, signal: 'SIGTERM', killed: true });
  expect(JSON.stringify(facts)).not.toContain('private-process-canary');
});

it('flushes case-start evidence before a real running test process is interrupted', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-interruption-'));
  const output = join(directory, 'progress.jsonl');
  let child;
  try {
    await writeFile(
      join(directory, 'vitest.config.mjs'),
      'export default {test:{include:["sample.test.mjs"]}};',
    );
    await writeFile(
      join(directory, 'sample.test.mjs'),
      `import {it} from ${JSON.stringify(pathToFileURL(resolve('node_modules/vitest/dist/index.js')).href)};it('private-running-name',()=>new Promise(()=>{}),10000);`,
    );
    child = spawn(
      process.execPath,
      [
        resolve('node_modules/vitest/vitest.mjs'),
        'run',
        '--config',
        join(directory, 'vitest.config.mjs'),
        '--reporter',
        resolve('scripts/dashboard-progress-reporter.mjs'),
      ],
      {
        cwd: directory,
        env: { ...process.env, ARXIC_DASHBOARD_PROGRESS_PATH: output },
        stdio: 'ignore',
      },
    );
    const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
    // The window is startup latency, not the property: a contended machine can
    // take well over 10s to cold-start the vitest child before it emits anything.
    await expect
      .poll(async () => readFile(output, 'utf8').catch(() => ''), { timeout: 60000 })
      .toContain('case-start');
    // Exercise a delayed controller beyond the old child's five-second completion.
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5500));
    const before = await readFile(output, 'utf8');
    expect(before).not.toContain('case-result');
    expect(before).not.toContain('private-running-name');
    expect(child.exitCode).toBe(null);
    child.kill('SIGTERM');
    await exited;
    expect(await readFile(output, 'utf8')).toContain('case-start');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);

it('distinguishes a real output-bound failure from a signalled child', async () => {
  const { commandFailureFacts } = await import('./command-failure.mjs');
  const failure = await promisify(execFile)(
    process.execPath,
    ['-e', 'console.log("private-output-canary".repeat(100))'],
    { maxBuffer: 32, timeout: 2000 },
  ).catch((error) => error);
  expect(commandFailureFacts(failure).code).toBe('ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
  expect(JSON.stringify(commandFailureFacts(failure))).not.toContain('private-output-canary');
});
