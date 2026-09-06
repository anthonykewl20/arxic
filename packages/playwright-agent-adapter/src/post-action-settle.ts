import type { Page } from '@playwright/test';

// Package-owned constant source is shared by the in-process exploration service
// and independently compiled replays. Function.toString() is unsuitable here:
// bundling changes its bytes and breaks the verifier's trusted-source binding.
const FUNCTION_SOURCE = `async function runAndSettleAction(page, action, timeoutMs) {
  const pending = /* @__PURE__ */ new Set();
  let lastActivity = Date.now();
  const callbacks = [
    (request) => {
      if (!["document", "fetch", "xhr"].includes(request.resourceType())) return;
      pending.add(request);
      lastActivity = Date.now();
    },
    (request) => {
      if (pending.delete(request)) lastActivity = Date.now();
    },
    (frame) => {
      if (frame !== page.mainFrame()) return;
      for (const request of pending) {
        if (!request.isNavigationRequest()) pending.delete(request);
      }
      lastActivity = Date.now();
    }
  ];
  page.on("request", callbacks[0]);
  page.on("requestfinished", callbacks[1]);
  page.on("requestfailed", callbacks[1]);
  page.on("framenavigated", callbacks[2]);
  try {
    await action();
    const deadline = Date.now() + timeoutMs;
    let prior = "";
    let stableSince = Date.now();
    while (Date.now() < deadline) {
      try {
        const snapshot = \`\${page.url()}
\${await page.locator("body").ariaSnapshot({ timeout: Math.max(1, Math.min(250, deadline - Date.now())) })}\`;
        if (snapshot !== prior) {
          prior = snapshot;
          stableSince = Date.now();
        }
        if (pending.size === 0 && Date.now() - Math.max(stableSince, lastActivity) >= 250) return;
      } catch {
        stableSince = Date.now();
      }
      await new Promise((done) => setTimeout(done, 25));
    }
    throw new Error("Post-action observation did not settle within the action budget");
  } finally {
    page.off("request", callbacks[0]);
    page.off("requestfinished", callbacks[1]);
    page.off("requestfailed", callbacks[1]);
    page.off("framenavigated", callbacks[2]);
  }
}`;

/** Compile only the constant above; neither pages nor callers supply code. */
export const runAndSettleAction = new Function(`return (${FUNCTION_SOURCE});`)() as (
  page: Page,
  action: () => Promise<void>,
  timeoutMs: number,
) => Promise<void>;

/** Stable source, hash-bound in the package-owned transition runtime. */
export function postActionSettleRuntimeSource(): string {
  return `export const runAndSettleAction = ${FUNCTION_SOURCE};`;
}
