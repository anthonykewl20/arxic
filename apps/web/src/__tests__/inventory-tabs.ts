import type { Page } from 'playwright';

/**
 * Intent inventory presents its three dimensions as tabs, so a journey that
 * asserts against surfaces, workflows or declarations selects the one it means.
 * Surfaces is the default and needs no call.
 */
export async function openInventoryTab(page: Page, tab: 'Surfaces' | 'Workflows' | 'Declarations') {
  // Not an exact match: a tab announces its count as part of its name
  // ("Declarations 42"), which is worth hearing and is not stable to assert on.
  await page.getByRole('tab', { name: tab }).click();
  await page.getByRole('tabpanel').first().waitFor();
}
