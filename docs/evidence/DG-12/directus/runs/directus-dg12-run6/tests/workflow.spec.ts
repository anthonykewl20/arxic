import { test, expect, assertNetworkContained, assertPageOrigin, configureApprovedOrigins, enforceNetworkContainment } from '../fixtures/workflow.fixture';
import { armReceiptCapture, recordTransitionReceipt } from '../fixtures/transition-receipts';
import { capturePolicyScreenshot } from '../fixtures/screenshot-privacy';

configureApprovedOrigins(["http://127.0.0.1:45283"]);

test("prop:935b6905502e3b99", async ({ page, context }) => {
  await test.step("admin-page → admin-login-page", async () => {
    armReceiptCapture(page);
    await page.goto("http://127.0.0.1:45283/admin/login");
    assertPageOrigin(page);
    assertNetworkContained(context);
    const form = page.locator('form').filter({ has: page.getByLabel("Email") }).filter({ has: page.getByLabel("Password") }).filter({ has: page.getByRole('button', { name: "Sign In", exact: true }) });
    await expect(form).toHaveCount(1);
    await form.getByLabel("Email").fill(process.env["ARXIC_INPUT_PERSONA_EMAIL"] ?? '');
    await form.getByLabel("Password").fill(process.env["ARXIC_INPUT_PERSONA_PASSWORD"] ?? '');
    await enforceNetworkContainment(page, () => form.getByRole('button', { name: "Sign In", exact: true }).click());
    assertNetworkContained(context);
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:45283\/admin\/login(?:[?#].*)?$/);
    await capturePolicyScreenshot(page, "artifacts/screenshots/step-1-admin-page-admin-login-page.png");
    recordTransitionReceipt(page, "admin-page->admin-login-page", "admin-page → admin-login-page");
  });
});
