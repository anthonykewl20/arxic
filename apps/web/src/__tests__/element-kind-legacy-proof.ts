import { join } from 'node:path';
import type { Page } from 'playwright';
import { expect } from 'vitest';
import { dashboardProof } from './dashboard-proof';

/** Historical response-format boundary, using the current real capture's unchanged geometry/pixels. */
export async function inspectLegacyElementKinds(page: Page, theme: string) {
  const proof = dashboardProof(
    page,
    process.env.ARXIC_ELEMENTS_EVIDENCE_DIR
      ? join(process.env.ARXIC_ELEMENTS_EVIDENCE_DIR, theme, 'legacy')
      : undefined,
  );
  await page.route('**/*.assessment.json', async (route) => {
    const response = await route.fetch();
    const report = await response.json();
    delete report.scene.kindSchemaVersion;
    for (const node of report.scene.nodes) delete node.kind;
    await route.fulfill({ response, json: report });
  });
  try {
    await page.getByRole('button', { name: 'Retry element measurements' }).click();
    await page.getByRole('button', { name: 'Inspect captured elements', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Captured elements' });
    await panel.getByRole('img', { name: 'Pick an element in captured screenshot' }).waitFor();
    await panel
      .getByText(
        'Older capture: element types were not recorded. Screenshot picking and element-number search are still available.',
        { exact: true },
      )
      .waitFor();
    await panel.getByLabel('Element type', { exact: true }).selectOption('unknown');
    await panel.getByLabel('Find element number').fill('0');
    await panel.getByRole('button', { name: 'Inspect element 0', exact: true }).click();
    await panel.getByText('Type: Unknown', { exact: true }).waitFor();
    await panel.getByLabel('Element type', { exact: true }).scrollIntoViewIfNeeded();
    const audit = await proof.audit(
      '01-legacy-types',
      'Historical numeric-only evidence remains inspectable with unknown type coverage',
    );
    expect(audit.details).toEqual([]);
    expect(audit.overflow).toBe(0);
    await panel.getByLabel('Element type', { exact: true }).selectOption('1');
    expect(await panel.getByRole('button', { name: /^Inspect element / }).count()).toBe(0);
    await panel
      .getByText('No elements match. Clear the filters or choose another point.', { exact: true })
      .waitFor();
    await panel.getByRole('button', { name: 'Show all captured elements', exact: true }).click();
    await panel.getByRole('button', { name: 'Inspect element 0', exact: true }).waitFor();
  } finally {
    await page.unroute('**/*.assessment.json');
    await proof.finish();
  }
  // A real reload retrieves the current version after the historical response boundary is removed.
  await page.reload();
  await page.getByText('Measured checks and coverage', { exact: true }).click();
  await page.getByRole('button', { name: 'Inspect captured elements', exact: true }).waitFor();
}
