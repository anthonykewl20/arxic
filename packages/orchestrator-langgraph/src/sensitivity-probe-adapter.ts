import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Workflow } from '@arxic/contracts';
import { probeAssertionSensitivity } from '@arxic/playwright-compiler';
import { screenshotPrivacyRuntimeSource } from '@arxic/playwright-screenshot-privacy';
import { runPlaywrightSuite } from '@arxic/verifier';

export type SensitivityProbeAdapterOptions = Readonly<{
  parentDirectory?: string;
  env?: NodeJS.ProcessEnv;
}>;

export function createSensitivityProbeAdapter(options: SensitivityProbeAdapterOptions = {}) {
  return async (input: { workflow: Workflow; origin: string; runtimeUrl?: string }) =>
    probeAssertionSensitivity({
      ...input,
      writeProbeDirectory: async (files) => {
        const parentDirectory = options.parentDirectory ?? process.cwd();
        await mkdir(parentDirectory, { recursive: true });
        const directory = await mkdtemp(join(parentDirectory, '.arxic-sensitivity-probe-'));
        await Promise.all([
          mkdir(join(directory, 'tests'), { recursive: true }),
          mkdir(join(directory, 'fixtures'), { recursive: true }),
        ]);
        await Promise.all([
          writeFile(join(directory, 'tests/workflow.spec.ts'), files.spec, 'utf8'),
          writeFile(join(directory, 'fixtures/workflow.fixture.ts'), files.fixture, 'utf8'),
          writeFile(
            join(directory, 'fixtures/screenshot-privacy.ts'),
            screenshotPrivacyRuntimeSource(),
            'utf8',
          ),
          writeFile(join(directory, 'playwright.config.ts'), files.config, 'utf8'),
        ]);
        return directory;
      },
      runSuite: async ({ testDirectory }) => {
        try {
          return await runPlaywrightSuite({
            testDirectory,
            ...(options.env ? { env: options.env } : {}),
            trace: 'discard',
          });
        } finally {
          await rm(testDirectory, { recursive: true });
        }
      },
    });
}
