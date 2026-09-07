import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { validateProject } from '../projects';
import { planVisualMatrix } from '../visual-matrix';

const folder = resolve(import.meta.dirname, '../../../..');

it('refuses a density/viewport product beyond the retained PNG pixel limit', async () => {
  await expect(
    validateProject(
      {
        name: 'Oversized density',
        folder,
        deviceScaleFactors: [3],
        viewports: [{ width: 1920, height: 1200 }],
      },
      [folder],
    ),
  ).rejects.toThrow(/pixel limit/);
});

it.each([[], null, [0], [4], [1.5], ['2'], [1, 1]])(
  'refuses unsupported density selections %j',
  async (deviceScaleFactors) => {
    await expect(
      validateProject({ name: 'Density', folder, deviceScaleFactors }, [folder]),
    ).rejects.toThrow();
  },
);

it('admits canonical density selections and budgets all 18 environments', async () => {
  const project = await validateProject(
    {
      name: 'Density',
      folder,
      deviceScaleFactors: [3, 1, 2],
      browsers: ['chromium', 'firefox', 'webkit'],
      colorSchemes: ['light', 'dark'],
    },
    [folder],
  );
  expect(project).toMatchObject({ deviceScaleFactors: [1, 2, 3] });
  const plan = planVisualMatrix(project);
  expect(plan.environments).toHaveLength(18);
  expect(new Set(plan.environments.map((cell) => JSON.stringify(cell))).size).toBe(18);
  expect(plan.pageBudget).toBe(16);
});

it('keeps omitted density at the original single environment', async () => {
  const project = await validateProject({ name: 'Legacy', folder }, [folder]);
  expect(planVisualMatrix(project).environments).toEqual([
    { browser: 'chromium', colorScheme: 'light' },
  ]);
});
