import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { validateProject } from '../projects';

const folder = resolve(import.meta.dirname, '../../../..');

it('keeps omitted visual change ratio at the pixel-exact default', async () => {
  const project = await validateProject({ name: 'Ratio default', folder }, [folder]);
  expect(project.visualChangeRatio).toBe(0);
});

it.each([0, 0.005, 0.5])('admits visual change ratio %j', async (visualChangeRatio) => {
  const project = await validateProject({ name: 'Ratio', folder, visualChangeRatio }, [folder]);
  expect(project.visualChangeRatio).toBe(visualChangeRatio);
});

it.each([-0.1, 0.6, 1.5, 'abc', Number.NaN, null])(
  'refuses unsupported visual change ratio %j',
  async (visualChangeRatio) => {
    await expect(
      validateProject({ name: 'Ratio', folder, visualChangeRatio }, [folder]),
    ).rejects.toThrow('visualChangeRatio must be a number from 0 to 0.5');
  },
);

it('keeps the unknown-setting rejection for fields outside the whitelist', async () => {
  await expect(
    validateProject({ name: 'Ratio', folder, pixelTolerance: 0.2 }, [folder]),
  ).rejects.toThrow('Unknown project setting');
});
