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

configureApprovedOrigins(["http://127.0.0.1:26705","http://127.0.0.1:8123","https://app.lemonsqueezy.com","https://assets.lemonsqueezy.com"]);

test("prop:cb45fce2b7cdf7f4", async ({ page, context }) => {
  await test.step("home → home", async () => {
    armReceiptCapture(page);
    await withReceiptAttribution(page, 'navigate', () => page.goto("http://127.0.0.1:26705/#/home"));
    assertPageOrigin(page);
    assertNetworkContained(context);
    const form = page.locator('form').filter({ has: labelOrPlaceholderControl(page, "Your email address") }).filter({ has: labelOrPlaceholderControl(page, "Your password") }).filter({ has: page.getByRole('button', { name: "Log In", exact: true }) });
    await expect(form).toHaveCount(1);
    await labelOrPlaceholderControl(form, "Your email address").fill(process.env["ARXIC_INPUT_PERSONA_EMAIL"] ?? '');
    await labelOrPlaceholderControl(form, "Your password").fill(process.env["ARXIC_INPUT_PERSONA_PASSWORD"] ?? '');
    await enforceNetworkContainment(page, () => form.getByRole('button', { name: "Log In", exact: true }).click());
    assertNetworkContained(context);
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:26705\/(?:[?#].*)?$/);
    await capturePolicyScreenshot(page, "artifacts/screenshots/step-1-home-home.png");
    recordTransitionReceipt(page, "home->home", "home → home");
  });
});
