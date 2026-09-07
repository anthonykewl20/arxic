import { resizeDashboard } from './dashboard-browser';
import { join } from 'node:path';
import { chromium, firefox, webkit, type Page } from 'playwright';
import type { Run } from '../types';
import { expect } from 'vitest';
import { dashboardProof } from './dashboard-proof';

export async function inspectCapturedElements(page: Page, targetOrigin: string, theme: string) {
  const runId = new URL(page.url()).searchParams.get('run');
  const response = await page.request.get(`${new URL(page.url()).origin}/api/runs/${runId}`);
  expect(response.status()).toBe(200);
  const run = (await response.json()) as Run;
  const capture = run.result!.captures![0];
  expect(capture.viewport).toEqual({ width: 800, height: 600 });
  const environment = capture.environment ?? { browser: 'chromium', colorScheme: 'light' };
  // The UI browser need not be the engine that produced the retained screenshot.
  const { expected, expectedButtons, expectedButton } = await (async () => {
    const targetBrowser = await { chromium, firefox, webkit }[environment.browser].launch();
    try {
      const target = await targetBrowser.newPage({
        viewport: capture.viewport,
        colorScheme: environment.colorScheme,
        locale: 'en-US',
        timezoneId: 'UTC',
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
      });
      await target.goto(targetOrigin);
      const expected = await target
        .getByRole('heading', { name: 'Vulnerable Auth App', exact: true })
        .evaluate((element) => {
          const rect = element.getBoundingClientRect(),
            parent = element.parentElement!.getBoundingClientRect();
          return {
            node: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            parent: { x: parent.x, y: parent.y, width: parent.width, height: parent.height },
          };
        });
      const expectedButtons = await target.getByRole('button').count();
      const expectedButton = (await target
        .getByRole('button', { name: 'Login', exact: true })
        .boundingBox())!;

      return { expected, expectedButtons, expectedButton };
    } finally {
      await targetBrowser.close();
    }
  })();
  const proof = dashboardProof(
    page,
    process.env.ARXIC_ELEMENTS_EVIDENCE_DIR
      ? join(process.env.ARXIC_ELEMENTS_EVIDENCE_DIR, theme)
      : undefined,
  );
  async function audit(name: string, action: string) {
    const report = await proof.audit(name, action);
    expect(report.details).toEqual([]);
    expect(report.overflow).toBe(0);
  }
  const panel = page.getByRole('region', { name: 'Captured elements' });
  const image = panel.getByRole('img', { name: 'Pick an element in captured screenshot' });
  async function checkBox(rect: typeof expected.node) {
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(Number(await image.locator('rect').last().getAttribute(key))).toBe(rect[key]);
  }
  async function pickHeading() {
    const box = (await image.boundingBox())!;
    await image.click({
      position: {
        x: ((expected.node.x + expected.node.width / 2) * box.width) / 800,
        y: ((expected.node.y + expected.node.height / 2) * box.height) / 600,
      },
    });
    await checkBox(expected.node);
  }
  try {
    await page.route('**/artifacts/checkpoint-1.png?*', (route) =>
      route.fulfill({ status: 503, body: 'Unavailable' }),
    );
    await page.getByRole('button', { name: 'Inspect captured elements', exact: true }).click();
    await panel.getByRole('button', { name: 'Retry element image' }).waitFor();
    expect(await image.count()).toBe(0);
    await panel.scrollIntoViewIfNeeded();
    await audit(
      '01-image-unavailable',
      'Image load failure disables element picking and offers retry',
    );
    await page.unroute('**/artifacts/checkpoint-1.png?*');
    await panel.getByRole('button', { name: 'Retry element image' }).click();
    await image.waitFor();
    await panel.getByLabel('Element type', { exact: true }).selectOption('1');
    expect(await panel.getByRole('button', { name: /^Inspect element / }).count()).toBe(
      expectedButtons,
    );
    expect(await panel.getByRole('status').textContent()).toContain(
      `${expectedButtons} matching elements`,
    );
    const firstButton = panel.getByRole('button', { name: /^Inspect element / }).first();
    await firstButton.focus();
    await page.keyboard.press('Enter');
    await checkBox(expectedButton);
    await panel.getByText('Type: Button', { exact: true }).waitFor();
    const firstId = (await firstButton.textContent())!.match(/\d+/u)![0];
    await panel.getByLabel('Find element number').fill(firstId);
    expect(await panel.getByRole('button', { name: /^Inspect element / }).count()).toBe(1);
    await panel.getByLabel('Find element number').fill('');
    for (const width of [320, 390, 768, 1440]) {
      await resizeDashboard(page, { width, height: 1000 });
      await panel.getByLabel('Element type', { exact: true }).scrollIntoViewIfNeeded();
      await audit(
        `06-kind-filter-${width}`,
        'Element type and number filters remain reachable without horizontal overflow',
      );
    }
    const scaled = (await image.boundingBox())!;
    await image.click({
      position: {
        x: ((expectedButton.x + expectedButton.width / 2) * scaled.width) / 800,
        y: ((expectedButton.y + expectedButton.height / 2) * scaled.height) / 600,
      },
    });
    await checkBox(expectedButton);
    expect(await panel.getByRole('button', { name: /^Inspect element / }).count()).toBe(1);
    await panel.getByRole('button', { name: 'Show selected on screenshot' }).click();
    await audit(
      '07-type-and-point',
      'Type and screenshot-point filters select the independently measured real Login button',
    );
    await panel.getByRole('button', { name: /Inspect parent element/ }).click();
    expect(await panel.getByLabel('Element type', { exact: true }).inputValue()).toBe('all');
    await panel.getByLabel('Element type', { exact: true }).selectOption('1');
    await panel.getByLabel('Element type', { exact: true }).focus();
    await page.keyboard.press('ArrowUp');
    expect(await panel.getByLabel('Element type', { exact: true }).inputValue()).toBe('0');
    await page.keyboard.press('ArrowDown');
    expect(await panel.getByLabel('Element type', { exact: true }).inputValue()).toBe('1');
    await panel.getByRole('button', { name: 'Show all captured elements', exact: true }).click();
    await panel.getByLabel('Find element number').fill('999999');
    await panel
      .getByText('No elements match. Clear the filters or choose another point.', { exact: true })
      .waitFor();
    await panel
      .getByText('No elements match. Clear the filters or choose another point.', { exact: true })
      .scrollIntoViewIfNeeded();
    await audit('02-no-matches', 'Unknown element number has an explicit empty result');
    await panel.getByLabel('Find element number').fill('0');
    await panel.getByRole('button', { name: 'Inspect element 0', exact: true }).focus();
    await page.keyboard.press('Enter');
    await panel.getByRole('heading', { name: 'Element 0', exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Show all captured elements', exact: true }).click();
    await panel.getByRole('button', { name: 'Next elements', exact: true }).click();
    expect(
      await panel.getByRole('button', { name: 'Inspect element 0', exact: true }).count(),
    ).toBe(0);
    await panel.getByRole('button', { name: 'Previous elements', exact: true }).click();
    await panel.getByRole('button', { name: 'Inspect element 0', exact: true }).waitFor();
    await pickHeading();
    const checkDetails = panel.locator('details.element-checks');
    await checkDetails.locator('summary').waitFor();
    expect(await checkDetails.getAttribute('open')).toBeNull();
    await checkDetails.locator('summary').focus();
    await page.keyboard.press('Enter');
    await checkDetails
      .getByText(/Measurement references:/)
      .first()
      .waitFor();
    await page.keyboard.press('Enter');
    expect(await checkDetails.getAttribute('open')).toBeNull();
    await panel.getByRole('button', { name: 'Show selected on screenshot' }).click();
    await audit(
      '03-picked-heading',
      'Picked bounds exactly match an independently measured real-app heading',
    );
    await panel.getByRole('button', { name: /Inspect parent element/ }).click();
    expect(await panel.getByLabel('Element type', { exact: true }).inputValue()).toBe('all');
    await checkBox(expected.parent);
    expect(await checkDetails.getAttribute('open')).toBeNull();
    await panel.getByRole('button', { name: 'Show selected on screenshot' }).click();
    await audit(
      '04-parent',
      'Parent navigation matches independently measured reference-app bounds',
    );
    await resizeDashboard(page, { width: 390, height: 844 });
    await pickHeading();
    await panel
      .getByRole('region', { name: 'Selected element measurements' })
      .scrollIntoViewIfNeeded();
    await audit('05-mobile', 'Mobile screenshot picking maps to the same original CSS coordinates');
    await resizeDashboard(page, { width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Inspect captured elements', exact: true }).click();
  } finally {
    await page.unroute('**/artifacts/checkpoint-1.png?*');
    await proof.finish();
  }
}
