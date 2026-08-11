import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Workflow } from '@arxic/contracts';
import { afterEach, describe, expect, test } from 'vitest';
import {
  ARXIC_PROBE_HARNESS_UNUSABLE,
  ARXIC_PROBE_INSENSITIVE_ASSERTION,
  probeAssertionSensitivity,
  type ProbeSensitivityOptions,
} from './index';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('assertion sensitivity probe', () => {
  test('fails closed when the unmutated control cannot run successfully', async () => {
    const runs: string[] = [];
    const result = await probeAssertionSensitivity({
      ...probeOptions(workflowWithAssertions('url:/')),
      writeProbeDirectory: async (files) => {
        runs.push(files.spec);
        return writeProbeDirectory(files);
      },
      runSuite: async () => ({ passed: false, output: 'module resolution failed' }),
    });

    expect(result).toEqual({
      killed: false,
      probed: 0,
      controlPassed: false,
      diagnostics: [
        expect.objectContaining({
          code: ARXIC_PROBE_HARNESS_UNUSABLE,
          severity: 'blocked',
          message: expect.stringContaining('module resolution failed'),
        }),
      ],
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toContain('toHaveURL(/^http:\\/\\/127');
    expect(runs[0]).not.toContain('__arxic-probe-never__');
  });

  test('blocks an insensitive URL assertion when its mutation survives', async () => {
    const writtenSpecs: string[] = [];
    const writtenConfigs: string[] = [];
    const workflow = workflowWithAssertions('url:/');
    const original = structuredClone(workflow);
    const result = await probeAssertionSensitivity({
      ...probeOptions(workflow),
      writeProbeDirectory: async (files) => {
        writtenSpecs.push(files.spec);
        writtenConfigs.push(files.config);
        return writeProbeDirectory(files);
      },
      runSuite: async () => ({ passed: true, output: 'control and mutations passed' }),
    });

    expect(result).toEqual({
      killed: false,
      probed: 2,
      controlPassed: true,
      diagnostics: [
        expect.objectContaining({
          code: ARXIC_PROBE_INSENSITIVE_ASSERTION,
          severity: 'blocked',
          subject: 'authentication.login',
          message: expect.stringContaining('value mutation'),
        }),
        expect.objectContaining({
          code: ARXIC_PROBE_INSENSITIVE_ASSERTION,
          severity: 'blocked',
          subject: 'authentication.login',
          message: expect.stringContaining('transition action was omitted'),
        }),
      ],
    });
    expect(writtenSpecs).toHaveLength(3);
    expect(writtenSpecs[0]).not.toContain('__arxic-probe-never__');
    expect(writtenSpecs[1]).toContain('toHaveURL(/');
    expect(writtenSpecs[1]).toContain('__arxic-probe-never__');
    expect(writtenSpecs[1]).not.toContain('toHaveURL("');
    expect(writtenSpecs[2]).toContain('page.goto("http://127.0.0.1:3000/login")');
    expect(writtenSpecs[2]).not.toContain('__arxic-probe-never__');
    expect(writtenSpecs.every((spec) => !spec.includes('capturePolicyScreenshot'))).toBe(true);
    expect(writtenConfigs.every((config) => config.includes('trace: "off"'))).toBe(true);
    expect(workflow).toEqual(original);
  });

  test('accepts a sensitive assertion when the mutation is killed', async () => {
    const runResults = [true, false, false];
    const result = await probeAssertionSensitivity({
      ...probeOptions(workflowWithAssertions('url:/')),
      runSuite: async () => ({ passed: runResults.shift()! }),
    });

    expect(result).toEqual({ killed: true, probed: 2, controlPassed: true, diagnostics: [] });
  });

  test('blocks a value-tautology that survives action omission after value mutation is killed', async () => {
    const writtenSpecs: string[] = [];
    const runResults = [true, false, true];
    const result = await probeAssertionSensitivity({
      ...probeOptions(workflowWithAssertions('text:Login')),
      writeProbeDirectory: async (files) => {
        writtenSpecs.push(files.spec);
        return writeProbeDirectory(files);
      },
      runSuite: async () => ({ passed: runResults.shift()! }),
    });

    expect(result).toMatchObject({
      killed: false,
      probed: 2,
      controlPassed: true,
      diagnostics: [
        {
          code: ARXIC_PROBE_INSENSITIVE_ASSERTION,
          severity: 'blocked',
          message: expect.stringContaining('transition action was omitted'),
        },
      ],
    });
    expect(writtenSpecs[2]).toContain('page.goto');
    expect(writtenSpecs[2]).toContain('getByText("Login")');
    expect(writtenSpecs[2]).not.toContain('.fill(');
    expect(writtenSpecs[2]).not.toContain('.click(');
    expect(writtenSpecs[2]).not.toContain("getByRole('button'");
  });

  test('probes every URL and text assertion and reports surviving value and omission mutations', async () => {
    const mutations: string[] = [];
    const runResults = [true, true, false, false, true];
    const result = await probeAssertionSensitivity({
      ...probeOptions(workflowWithAssertions('url:/', 'text:Logged in')),
      writeProbeDirectory: async (files) => {
        mutations.push(files.spec);
        return writeProbeDirectory(files);
      },
      runSuite: async () => ({ passed: runResults.shift()! }),
    });

    expect(result).toMatchObject({
      killed: false,
      probed: 4,
      controlPassed: true,
      diagnostics: [
        {
          code: ARXIC_PROBE_INSENSITIVE_ASSERTION,
          severity: 'blocked',
          message: expect.stringContaining('value mutation'),
        },
        {
          code: ARXIC_PROBE_INSENSITIVE_ASSERTION,
          severity: 'blocked',
          message: expect.stringContaining('transition action was omitted'),
        },
      ],
    });
    expect(mutations[0]).not.toContain('__arxic-probe-never__');
    expect(mutations[1]).toContain('__arxic-probe-never__');
    expect(mutations[1]).toContain('getByText("Logged in")');
    expect(mutations[2]).toContain('toHaveURL(/^http:\\/\\/127');
    expect(mutations[2]).not.toContain('getByText("Logged in")');
    expect(mutations[3]).toContain('getByText("__arxic-probe-never-match__")');
    expect(mutations[4]).toContain('getByText("Logged in")');
  });

  test('writes an action-free control state for one assertion at the transition from-state', async () => {
    const writtenSpecs: string[] = [];
    const runResults = [true, false, false];
    const result = await probeAssertionSensitivity({
      ...probeOptions(workflowWithAssertions('text:Logged in')),
      writeProbeDirectory: async (files) => {
        writtenSpecs.push(files.spec);
        return writeProbeDirectory(files);
      },
      runSuite: async () => ({ passed: runResults.shift()! }),
    });

    expect(result).toEqual({ killed: true, probed: 2, controlPassed: true, diagnostics: [] });
    expect(writtenSpecs[2]).toContain('page.goto("http://127.0.0.1:3000/login")');
    expect(writtenSpecs[2]).toContain('getByText("Logged in")');
    expect(writtenSpecs[2]).not.toContain('.fill(');
    expect(writtenSpecs[2]).not.toContain('.click(');
    expect(writtenSpecs[2]).not.toContain("getByRole('button'");
  });

  test('reports all supported assertions killed when every mutation fails', async () => {
    const runResults = [true, false, false, false, false];
    const result = await probeAssertionSensitivity({
      ...probeOptions(workflowWithAssertions('url:/', 'text:Logged in')),
      runSuite: async () => ({ passed: runResults.shift()! }),
    });

    expect(result).toEqual({ killed: true, probed: 4, controlPassed: true, diagnostics: [] });
  });

  test('skips unsupported assertion kinds without running a suite', async () => {
    let ran = false;
    const result = await probeAssertionSensitivity({
      ...probeOptions(workflowWithAssertions('role:alert')),
      runSuite: async () => {
        ran = true;
        return { passed: true };
      },
    });

    expect(result).toEqual({ killed: false, probed: 0, controlPassed: false, diagnostics: [] });
    expect(ran).toBe(false);
  });
});

function probeOptions(workflow: Workflow): ProbeSensitivityOptions {
  return {
    workflow,
    origin: 'http://127.0.0.1:3000',
    writeProbeDirectory,
    runSuite: async () => ({ passed: true }),
  };
}

async function writeProbeDirectory(files: {
  spec: string;
  fixture: string;
  config: string;
}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-probe-'));
  directories.push(directory);
  await Promise.all([
    mkdir(join(directory, 'tests'), { recursive: true }),
    mkdir(join(directory, 'fixtures'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(directory, 'tests/workflow.spec.ts'), files.spec, 'utf8'),
    writeFile(join(directory, 'fixtures/workflow.fixture.ts'), files.fixture, 'utf8'),
    writeFile(join(directory, 'playwright.config.ts'), files.config, 'utf8'),
  ]);
  return directory;
}

function workflowWithAssertions(...intents: string[]): Workflow {
  return {
    $schema: 'https://arxic.dev/schemas/workflow/v1.json',
    id: 'authentication.login',
    version: 1,
    title: 'Login',
    domain: 'authentication',
    persona: 'registered-user',
    status: 'observed',
    confidence: 1,
    scope: {
      commit: '0123456789abcdef0123456789abcdef01234567',
      environment: 'local-test',
      browser: 'chromium',
    },
    preconditions: [{ fixture: 'user.exists' }],
    states: [{ id: 'login-page' }, { id: 'home' }],
    transitions: [
      {
        from: 'login-page',
        to: 'home',
        action: {
          intent: 'Submit login credentials',
          inputRefs: { email: 'persona.email', password: 'persona.password' },
        },
        assertions: intents.map((intent) => ({ intent })),
        evidenceRefs: ['src:login-handler'],
      },
    ],
    negativeCases: [],
    verification: {
      requiredRuns: 2,
      screenshotCheckpoints: ['home'],
      forbidNetworkErrors: true,
      trace: 'retain',
    },
    evidenceRefs: ['src:login-handler'],
  };
}
