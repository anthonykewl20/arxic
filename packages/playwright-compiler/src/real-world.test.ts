import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { validateManifest } from '@arxic/contracts';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  FIXTURE_APPS,
  bootFixtureApp,
  loginObservations,
  loginWorkflow,
  seedFixture,
  stopApp,
  type RunningApp,
} from '@arxic/real-world-testkit';
import { PlaywrightCompiler } from './index';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../../', import.meta.url));

describe.each(FIXTURE_APPS)('playwright compiler real-world proof: $name', (app) => {
  let running: RunningApp | undefined;
  let outputDirectory = '';

  beforeAll(async () => {
    running = await bootFixtureApp(root, app, `arxic-compiler-${app.name}`);
    outputDirectory = await mkdtemp(join(root, '.arxic-compiler-output-'));
    await seedFixture(running.origin, `compiler-${app.name}`, app.persona);
  }, 240_000);

  afterAll(async () => {
    await stopApp(running?.child);
    await Promise.all(
      [running?.runtimeDirectory, outputDirectory]
        .filter((path): path is string => Boolean(path))
        .map((path) => rm(path, { recursive: true })),
    );
  });

  test('stages a TypeScript suite discoverable by the real Playwright CLI', async () => {
    if (!running) throw new Error(`Fixture app ${app.name} did not start`);
    const workflow = loginWorkflow(app, {
      id: `authentication.login.compiler.${app.name}`,
      title: `Login compiler proof ${app.name}`,
    });
    const bundle = await new PlaywrightCompiler({
      outputDirectory,
      origin: running.origin,
      captureScreenshots: false,
    }).compile(workflow, loginObservations(app, running.origin, `real-world-compiler-${app.name}`));
    expect(validateManifest(bundle.manifest).ok).toBe(true);
    expect(bundle.plan).toContain(`${app.login.fromState} → ${app.login.toState}`);
    await ensurePlaywrightModule(outputDirectory);
    const cliPath = resolvePlaywrightCli();
    const listing = await execute(process.execPath, [cliPath, 'test', '--list'], {
      cwd: outputDirectory,
      timeout: 120_000,
    });
    const output = `${listing.stdout}${listing.stderr}`;
    expect(output).toContain(workflow.id);
    const spec = await readFile(join(outputDirectory, 'tests/workflow.spec.ts'), 'utf8');
    expect(spec).toContain('enforceNetworkContainment');
    const run = await execute(process.execPath, [cliPath, 'test'], {
      cwd: outputDirectory,
      env: {
        ...process.env,
        ARXIC_INPUT_PERSONA_EMAIL: app.persona.email,
        ARXIC_INPUT_PERSONA_PASSWORD: app.persona.password,
      },
      timeout: 120_000,
    }).catch((error: { stdout?: string; stderr?: string }) => {
      throw new Error(`${error.stdout ?? ''}${error.stderr ?? ''}`);
    });
    expect(`${run.stdout}${run.stderr}`).toContain('1 passed');
  }, 120_000);
});

function resolvePlaywrightCli(): string {
  try {
    return require.resolve('@playwright/test/cli.js');
  } catch {
    return require.resolve('@playwright/test/cli');
  }
}

async function ensurePlaywrightModule(directory: string): Promise<void> {
  const packageRoot = dirname(require.resolve('@playwright/test/package.json'));
  const scope = join(directory, 'node_modules', '@playwright');
  await mkdir(scope, { recursive: true });
  await symlink(packageRoot, join(scope, 'test'), 'dir');
}
