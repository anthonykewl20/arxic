import { expect, it } from 'vitest';
import { planVisualMatrix } from '../visual-matrix';
it('shares the 600-checkpoint budget across every selected environment and viewport', () => {
  const plan = planVisualMatrix({
    browsers: ['chromium', 'firefox', 'webkit'],
    colorSchemes: ['light', 'dark'],
    viewports: [
      { width: 320, height: 600 },
      { width: 800, height: 600 },
      { width: 1440, height: 900 },
    ],
  });
  expect(plan.environments).toEqual([
    { browser: 'chromium', colorScheme: 'light' },
    { browser: 'chromium', colorScheme: 'dark' },
    { browser: 'firefox', colorScheme: 'light' },
    { browser: 'firefox', colorScheme: 'dark' },
    { browser: 'webkit', colorScheme: 'light' },
    { browser: 'webkit', colorScheme: 'dark' },
  ]);
  expect(plan.pageBudget).toBe(33);
  expect(plan.pageBudget * 6 * 3).toBe(594);
  expect(
    planVisualMatrix({
      viewports: [
        { width: 320, height: 600 },
        { width: 800, height: 600 },
      ],
    }),
  ).toEqual({ environments: [{ browser: 'chromium', colorScheme: 'light' }], pageBudget: 300 });
});
