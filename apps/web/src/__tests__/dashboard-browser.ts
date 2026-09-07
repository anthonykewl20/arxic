import { chromium, firefox, webkit, type Page } from 'playwright';

export function dashboardBrowserName(value: string | undefined) {
  if (value === undefined) return 'chromium';
  if (value === 'chromium' || value === 'firefox' || value === 'webkit') return value;
  throw new Error('Unsupported dashboard browser; choose chromium, firefox or webkit');
}

/** Test driver only: target-capture engine selection remains owned by the product. */
export function launchDashboardBrowser(options: Parameters<typeof chromium.launch>[0] = {}) {
  const name = dashboardBrowserName(process.env.ARXIC_DASHBOARD_BROWSER);
  return { chromium, firefox, webkit }[name].launch({ headless: true, ...options });
}

/** Wait for the browser to apply viewport media queries before reading geometry. */
export async function resizeDashboard(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.waitForFunction(
    ({ width, height }) => innerWidth === width && innerHeight === height,
    size,
  );
  await settleDashboard(page);
}

/** Fixed readiness boundary; never wait for a finding predicate to become passing. */
export async function settleDashboard(page: Page) {
  await page.waitForFunction(() => document.fonts.status === 'loaded', undefined, {
    timeout: 5000,
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
