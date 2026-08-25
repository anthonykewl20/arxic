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

configureApprovedOrigins(["http://127.0.0.1:43647"]);

test("prop:7fab843cb753405c", async ({ page, context }) => {
  await test.step("admin-page → admin-login-page", async () => {
    armReceiptCapture(page);
    await withReceiptAttribution(page, 'navigate', () => page.goto("http://127.0.0.1:43647/admin/login"));
    assertPageOrigin(page);
    assertNetworkContained(context);
    const form = page.locator('form').filter({ has: labelOrPlaceholderControl(page, "Email") }).filter({ has: labelOrPlaceholderControl(page, "Password") }).filter({ has: page.getByRole('button', { name: "Sign In", exact: true }) });
    await expect(form).toHaveCount(1);
    await labelOrPlaceholderControl(form, "Email").fill(process.env["ARXIC_INPUT_PERSONA_EMAIL"] ?? '');
    await labelOrPlaceholderControl(form, "Password").fill(process.env["ARXIC_INPUT_PERSONA_PASSWORD"] ?? '');
    await enforceNetworkContainment(page, () => form.getByRole('button', { name: "Sign In", exact: true }).click());
    assertNetworkContained(context);
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:43647\/admin\/login(?:[?#].*)?$/);
    await capturePolicyScreenshot(page, "artifacts/screenshots/step-1-admin-page-admin-login-page.png");
    recordTransitionReceipt(page, "admin-page->admin-login-page", "admin-page → admin-login-page");
  });
});
