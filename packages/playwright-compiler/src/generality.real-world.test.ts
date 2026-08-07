import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chromium,
  expect as playwrightExpect,
  type Browser,
  type BrowserContext,
} from '@playwright/test';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  bootFixtureApp,
  loginObservations,
  loginWorkflow,
  stopApp,
  vulnerableAuthApp,
  type RunningApp,
} from '@arxic/real-world-testkit';
import { PlaywrightCompiler, generateSpec } from './index';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const submitName =
  /submit|log in|login|sign in|continue|send|change|reset|verify|confirm|enroll|register|sign up/i;

describe('playwright compiler generality on the vulnerable auth app', () => {
  let running: RunningApp | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let outputDirectory = '';

  beforeAll(async () => {
    running = await bootFixtureApp(root, vulnerableAuthApp, 'arxic-compiler-generality');
    outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-compiler-generality-output-'));
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
  }, 120_000);

  afterAll(async () => {
    await context?.close();
    await browser?.close();
    await stopApp(running?.child);
    await Promise.all(
      [running?.runtimeDirectory, outputDirectory]
        .filter((path): path is string => Boolean(path))
        .map((path) => rm(path, { recursive: true })),
    );
  });

  test('compiles the observed entry URL instead of the state-derived route', async () => {
    if (!running) throw new Error('Vulnerable fixture app did not start');
    const workflow = loginWorkflow(vulnerableAuthApp, {
      id: 'authentication.login.compiler-generality',
      title: 'Compiler runtime route generality',
    });
    workflow.states = [{ id: 'login-page' }, { id: 'home' }];
    workflow.transitions[0]!.from = 'login-page';

    await new PlaywrightCompiler({
      outputDirectory,
      origin: running.origin,
    }).compile(
      workflow,
      loginObservations(vulnerableAuthApp, running.origin, 'compiler-generality'),
    );

    const spec = await readFile(join(outputDirectory, 'tests/workflow.spec.ts'), 'utf8');
    expect(spec).toContain(`await page.goto(${JSON.stringify(`${running.origin}/`)})`);
    expect(spec).not.toContain(`await page.goto(${JSON.stringify(`${running.origin}/login`)})`);
  });

  test('surfaces residual single-input form ambiguity with the generated count guard', async () => {
    if (!running || !context) throw new Error('Real Chromium fixture context did not start');
    const page = await context.newPage();
    await page.goto(`${running.origin}/`);
    const emailForms = page.locator('form').filter({ has: page.getByLabel('Email') });
    const submitEmailForms = emailForms.filter({
      has: page.getByRole('button', { name: submitName }),
    });

    await playwrightExpect(emailForms).toHaveCount(2);
    await playwrightExpect(submitEmailForms).toHaveCount(2);
    await expect(
      playwrightExpect(submitEmailForms).toHaveCount(1, { timeout: 500 }),
    ).rejects.toThrow();

    const workflow = loginWorkflow(vulnerableAuthApp, {
      id: 'authentication.forgot.compiler-generality',
      title: 'Single-input compiler form guard',
    });
    workflow.transitions[0]!.action = {
      intent: 'Submit registered email',
      inputRefs: { email: 'persona.email' },
    };
    const generated = generateSpec(workflow, running.origin, `${running.origin}/`);
    expect(generated.spec).toContain('await expect(form).toHaveCount(1);');
    await page.close();
  });
});
