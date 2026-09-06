import type { Capture } from './types';

export const emptyCaptureFilters = {
  path: '',
  browser: '',
  colorScheme: '',
  viewport: '',
  status: '',
};
export type CaptureFilters = typeof emptyCaptureFilters;
export const capturePageSize = 6;
export const captureEnvironment = (capture: Capture) =>
  capture.environment ?? { browser: 'chromium' as const, colorScheme: 'light' as const };
export const captureViewport = (capture: Capture) =>
  `${capture.viewport.width}x${capture.viewport.height}`;

/** Read-only selection: preserve original capture objects and their evidence identities. */
export function selectCaptures(
  captures: Capture[],
  filters: CaptureFilters,
  requestedPage: number,
) {
  const items = captures.filter((capture) => {
    const environment = captureEnvironment(capture);
    return (
      capture.path.toLowerCase().includes(filters.path.trim().toLowerCase()) &&
      (!filters.browser || environment.browser === filters.browser) &&
      (!filters.colorScheme || environment.colorScheme === filters.colorScheme) &&
      (!filters.viewport || captureViewport(capture) === filters.viewport) &&
      (!filters.status || capture.status === filters.status)
    );
  });
  const pages = Math.ceil(items.length / capturePageSize);
  const page = Math.max(
    0,
    Math.min(Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0, pages - 1),
  );
  return {
    items: items.slice(page * capturePageSize, (page + 1) * capturePageSize),
    total: items.length,
    page,
    pages,
  };
}
