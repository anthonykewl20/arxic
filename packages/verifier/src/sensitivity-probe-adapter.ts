import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Workflow } from '@arxic/contracts';
import { probeAssertionSensitivity } from '@arxic/playwright-compiler';
import { runPlaywrightSuite } from './runner';
import { ensurePlaywrightModule } from './verifier';

export type SensitivityProbeAdapterOptions = Readonly<{
  parentDirectory?: string;
  env?: NodeJS.ProcessEnv;
  resetAndSeed?: (run: number) => Promise<void>;
}>;

export function createSensitivityProbeAdapter(options: SensitivityProbeAdapterOptions = {}) {
  return async (input: { workflow: Workflow; origin: string; runtimeUrl?: string }) => {
    let run = 0;
    return probeAssertionSensitivity({
      ...input,
      writeProbeDirectory: async (files) => {
        const parentDirectory = options.parentDirectory ?? tmpdir();
        await mkdir(parentDirectory, { recursive: true });
        const directory = await mkdtemp(join(parentDirectory, '.arxic-sensitivity-probe-'));
        try {
          await Promise.all([
            mkdir(join(directory, 'tests'), { recursive: true }),
            mkdir(join(directory, 'fixtures'), { recursive: true }),
          ]);
          await Promise.all([
            writeFile(join(directory, 'tests/workflow.spec.ts'), files.spec, 'utf8'),
            writeFile(join(directory, 'fixtures/workflow.fixture.ts'), files.fixture, 'utf8'),
            writeFile(join(directory, 'playwright.config.ts'), files.config, 'utf8'),
          ]);
          await ensurePlaywrightModule(directory);
          return directory;
        } catch (error) {
          await rm(directory, { recursive: true, force: true });
          throw error;
        }
      },
      runSuite: async ({ testDirectory }) => {
        try {
          run += 1;
          await options.resetAndSeed?.(run);
          return await runPlaywrightSuite({
            testDirectory,
            ...(options.env ? { env: options.env } : {}),
            trace: 'discard',
          });
        } finally {
          await rm(testDirectory, { recursive: true, force: true });
        }
      },
    });
  };
}
