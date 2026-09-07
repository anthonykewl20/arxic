import type { Page } from '@playwright/test';
import { normalizeBrowserPng } from './png';
import { ScreenshotPrivacyError } from './standalone-runtime';

/** Capture mechanics for trusted application-owned viewport checks, not verifier attestation. */
export async function captureMaskedViewport(
  page: Page,
  input: {
    automaticMasks: readonly string[];
    requiredMasks: readonly string[];
    scale?: 'css' | 'device';
  },
): Promise<Buffer> {
  const required = input.requiredMasks.map((selector) => page.locator(selector));
  for (const mask of required) {
    if ((await mask.count()) === 0)
      throw new ScreenshotPrivacyError(
        'ARXIC-SCREENSHOT-CAPTURE-INVALID',
        'Required privacy mask did not match',
      );
  }
  const bytes = await page.screenshot({
    type: 'png',
    fullPage: false,
    animations: 'disabled',
    caret: 'hide',
    scale: input.scale ?? 'css',
    mask: [...input.automaticMasks.map((selector) => page.locator(selector)), ...required],
    timeout: 15_000,
  });
  return normalizeBrowserPng(bytes);
}
