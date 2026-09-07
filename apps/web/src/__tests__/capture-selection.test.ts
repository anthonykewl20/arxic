import { expect, it } from 'vitest';
import type { Capture } from '../types';
import { selectCaptures, emptyCaptureFilters } from '../capture-selection';
const captures: Capture[] = Array.from({ length: 31 }, (_, i) => ({
  id: String(i),
  path: i % 2 ? '/settings' : '/login',
  viewport: { width: 800, height: 600 },
  file: `checkpoint-${i}.png`,
  sha256: 'a'.repeat(64),
  specHash: String(i),
  browserVersion: 'test',
  status: i % 2 ? 'changed' : 'unchanged',
  ...(i ? { environment: { browser: 'webkit' as const, colorScheme: 'dark' as const } } : {}),
}));
it('combines filters, preserves capture references and clamps pages', () => {
  const f = {
    ...emptyCaptureFilters,
    path: 'SETTINGS',
    browser: 'webkit',
    colorScheme: 'dark',
    status: 'changed',
    viewport: '800x600',
  };
  const result = selectCaptures(captures, f, 999);
  expect(result.total).toBe(15);
  expect(result.page).toBe(2);
  expect(result.items).toEqual([captures[25], captures[27], captures[29]]);
  expect(result.items[0]).toBe(captures[25]);
  expect(selectCaptures(captures, { ...f, path: '/missing' }, 9)).toMatchObject({
    items: [],
    total: 0,
    page: 0,
  });
});
it('legacy captures retain the documented Chromium/light environment and paging is bounded', () => {
  expect(
    selectCaptures(
      captures,
      { ...emptyCaptureFilters, browser: 'chromium', colorScheme: 'light' },
      0,
    ).items,
  ).toEqual([captures[0]]);
  expect(selectCaptures(captures, emptyCaptureFilters, 0).items).toHaveLength(6);
  expect(selectCaptures(captures, emptyCaptureFilters, -1).page).toBe(0);
});

it('isolates native pixel density while retaining legacy 1x capture identities', () => {
  const dense: Capture = {
    ...captures[0],
    id: 'dense',
    environment: { browser: 'chromium', colorScheme: 'light', deviceScaleFactor: 2 },
  };
  const all = [captures[0], dense];
  expect(selectCaptures(all, { ...emptyCaptureFilters, deviceScaleFactor: '2' }, 0).items).toEqual([
    dense,
  ]);
  expect(selectCaptures(all, { ...emptyCaptureFilters, deviceScaleFactor: '1' }, 0).items).toEqual([
    captures[0],
  ]);
  expect(selectCaptures(all, { ...emptyCaptureFilters, deviceScaleFactor: '3' }, 0).total).toBe(0);
});
