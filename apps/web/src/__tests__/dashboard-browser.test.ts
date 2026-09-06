import { expect, it } from 'vitest';
import { dashboardBrowserName } from './dashboard-browser';
it.each(['', 'safari', 'edge', 'Chromium', 'webkit,firefox'])(
  'rejects unsupported dashboard browser %s',
  (name) => {
    expect(() => dashboardBrowserName(name)).toThrow('Unsupported dashboard browser');
  },
);
it('defaults only an absent browser and accepts each explicit engine', () => {
  expect(dashboardBrowserName(undefined)).toBe('chromium');
  for (const name of ['chromium', 'firefox', 'webkit'])
    expect(dashboardBrowserName(name)).toBe(name);
});
