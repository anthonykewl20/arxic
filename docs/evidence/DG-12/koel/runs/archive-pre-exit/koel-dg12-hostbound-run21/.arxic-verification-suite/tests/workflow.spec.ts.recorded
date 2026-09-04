import { test, expect, assertNetworkContained, assertPageOrigin, configureApprovedOrigins, enforceNetworkContainment } from '../fixtures/workflow.fixture';
import {
  armReceiptCapture,
  recordTransitionReceipt,
  withReceiptAttribution,
} from '../fixtures/transition-receipts';
import { capturePolicyScreenshot } from '../fixtures/screenshot-privacy';

// #312 (F-E9): label-first with placeholder fallback — the #303
// exploration-lane semantics. A control the page addresses only by
// placeholder (the real directus login shape: zero <label> elements)
// binds through the fallback; the unique-form fail-closed gate is
// unchanged.
function labelOrPlaceholderControl(root, text) {
  return root.getByLabel(text).or(root.getByPlaceholder(text));
}

// #383: submit controls bind by accessible name OR exact text content.
// The captured koel login shape (koel @ dfec91ff, live capture 2026-09-04)
// renders a label-wrapped <button type="submit">Log In</button> whose
// accessible name is EMPTY in Chromium's a11y tree (aria snapshot
// `- button: Log In` — text content only), so a name-only binding can
// never resolve it and the form filter yields 0. The union semantics keep
// named controls resolving once (both branches match the same element)
// and refuse — strict mode — when the branches match DIFFERENT controls.
function submitControl(root, name) {
  const exactText = new RegExp("^\\s*" + name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&") + "\\s*$");
  return root.getByRole('button', { name, exact: true }).or(root.locator('button').filter({ hasText: exactText }));
}
function submitControlByPattern(root, pattern) {
  return root.getByRole('button', { name: pattern }).or(root.locator('button').filter({ hasText: pattern }));
}

configureApprovedOrigins(["http://127.0.0.1:32425","http://127.0.0.1:8123"]);

test("prop:22e712143d7cb7e2", async ({ page, context }) => {
  await test.step("home → home", async () => {
    armReceiptCapture(page);
    await withReceiptAttribution(page, 'navigate', () => page.goto("http://127.0.0.1:32425/#/home"));
    assertPageOrigin(page);
    assertNetworkContained(context);
    const form = page.locator('form').filter({ has: labelOrPlaceholderControl(page, "Your email address") }).filter({ has: labelOrPlaceholderControl(page, "Your password") }).filter({ has: submitControl(page, "Log In") });
    await expect(form).toHaveCount(1);
    await labelOrPlaceholderControl(form, "Your email address").fill(process.env["ARXIC_INPUT_PERSONA_EMAIL"] ?? '');
    await labelOrPlaceholderControl(form, "Your password").fill(process.env["ARXIC_INPUT_PERSONA_PASSWORD"] ?? '');
    await enforceNetworkContainment(page, () => submitControl(form, "Log In").click());
    assertNetworkContained(context);
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:32425\/(?:[?#].*)?$/);
    await capturePolicyScreenshot(page, "artifacts/screenshots/step-1-home-home.png");
    recordTransitionReceipt(page, "home->home", "home → home");
  });
});
