import { test, expect, assertNetworkContained, assertPageOrigin, configureApprovedOrigins, enforceNetworkContainment } from '../fixtures/workflow.fixture';
import { recordTransitionReceipt } from '../fixtures/transition-receipts';
import { capturePolicyScreenshot } from '../fixtures/screenshot-privacy';

configureApprovedOrigins(["http://127.0.0.1:35997"]);

test("prop:00c10529a1518564", async ({ page, context }) => {
  await test.step("admin-page → admin-login-page", async () => {
    await page.goto("http://127.0.0.1:35997/admin/login");
    assertPageOrigin(page);
    assertNetworkContained(context);
    const form = page.locator('form').filter({ has: page.getByLabel("Email") }).filter({ has: page.getByLabel("Password") }).filter({ has: page.getByRole('button', { name: "Sign In", exact: true }) });
    await expect(form).toHaveCount(1);
    await form.getByLabel("Email").fill(process.env["ARXIC_INPUT_PERSONA_EMAIL"] ?? '');
    await form.getByLabel("Password").fill(process.env["ARXIC_INPUT_PERSONA_PASSWORD"] ?? '');
    await enforceNetworkContainment(page, () => form.getByRole('button', { name: "Sign In", exact: true }).click());
    assertNetworkContained(context);
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:35997\/admin\/login(?:[?#].*)?$/);
    await capturePolicyScreenshot(page, "artifacts/screenshots/step-1-admin-page-admin-login-page.png");
    recordTransitionReceipt(page, "admin-page->admin-login-page", "admin-page → admin-login-page");
  });
});
