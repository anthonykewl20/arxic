import type { Frame, Page, Request } from '@playwright/test';

/** Observe the completed action, not the DOM that happened to exist at click return. */
export async function runAndSettleAction(
  page: Page,
  action: () => Promise<void>,
  timeoutMs: number,
): Promise<void> {
  const pending = new Set<Request>();
  let lastActivity = Date.now();
  const started = (request: Request) => {
    if (!['document', 'fetch', 'xhr'].includes(request.resourceType())) return;
    pending.add(request);
    lastActivity = Date.now();
  };
  const finished = (request: Request) => {
    if (pending.delete(request)) lastActivity = Date.now();
  };
  const navigated = (frame: Frame) => {
    if (frame !== page.mainFrame()) return;
    // A committed navigation abandons the old document's fetch bodies;
    // Chromium need not emit requestfinished for those requests.
    for (const request of pending) {
      if (!request.isNavigationRequest()) pending.delete(request);
    }
    lastActivity = Date.now();
  };
  page.on('request', started);
  page.on('requestfinished', finished);
  page.on('requestfailed', finished);
  page.on('framenavigated', navigated);
  try {
    await action();
    const deadline = Date.now() + timeoutMs;
    let prior = '';
    let stableSince = Date.now();
    while (Date.now() < deadline) {
      try {
        const snapshot = `${page.url()}\n${await page.locator('body').ariaSnapshot({ timeout: Math.max(1, Math.min(250, deadline - Date.now())) })}`;
        if (snapshot !== prior) {
          prior = snapshot;
          stableSince = Date.now();
        }
        // Network completion alone precedes SPA rendering. Require a quiet
        // accessibility/URL observation too, and fail closed on a hanging action.
        if (pending.size === 0 && Date.now() - Math.max(stableSince, lastActivity) >= 250) return;
      } catch {
        // Navigation may replace the document while the outcome is settling.
        stableSince = Date.now();
      }
      await new Promise((done) => setTimeout(done, 25));
    }
    throw new Error('Post-action observation did not settle within the action budget');
  } finally {
    page.off('request', started);
    page.off('requestfinished', finished);
    page.off('requestfailed', finished);
    page.off('framenavigated', navigated);
  }
}
