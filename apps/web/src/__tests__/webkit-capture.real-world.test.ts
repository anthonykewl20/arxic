import { it } from 'vitest';
import { webkit } from 'playwright';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import {
  bootFixtureApp,
  stopApp,
  vulnerableAuthApp,
} from '../../../../packages/real-world-testkit/src';
import { collectVisualScene } from '../visual-oracle';
import { captureMaskedViewport, inspectPng } from '@arxic/playwright-screenshot-privacy';
it('normalizes actual WebKit capture metadata into strict retained evidence', async () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const target = await bootFixtureApp(root, vulnerableAuthApp, 'webkit-probe');
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage();
    await page.goto(target.origin);
    await collectVisualScene(page);
    const bytes = await captureMaskedViewport(page, {
      automaticMasks: ['input'],
      requiredMasks: [],
    });
    inspectPng(bytes);
  } finally {
    await browser.close();
    await stopApp(target.child);
    await rm(target.runtimeDirectory, { recursive: true, force: true });
  }
}, 30000);
