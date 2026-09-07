import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { validateProject } from '../projects';

const folder = resolve(import.meta.dirname, '../../../..');
it.each([
  { browsers: [] },
  { browsers: null },
  { colorSchemes: null },
  { browsers: ['safari'] },
  { browsers: ['chromium', 'chromium'] },
  { colorSchemes: [] },
  { colorSchemes: ['system'] },
  { colorSchemes: ['dark', 'dark'] },
])('rejects ambiguous or unsupported visual environments: %j', async (settings) => {
  await expect(validateProject({ name: 'Matrix', folder, ...settings }, [folder])).rejects.toThrow(
    /Choose distinct supported visual/,
  );
});

it('defaults older requests to Chromium/light and canonicalizes explicit selections', async () => {
  expect(await validateProject({ name: 'Old', folder }, [folder])).toMatchObject({
    browsers: ['chromium'],
    colorSchemes: ['light'],
  });
  expect(
    await validateProject(
      { name: 'Matrix', folder, browsers: ['webkit', 'chromium'], colorSchemes: ['dark', 'light'] },
      [folder],
    ),
  ).toMatchObject({
    browsers: ['chromium', 'webkit'],
    colorSchemes: ['light', 'dark'],
  });
});
