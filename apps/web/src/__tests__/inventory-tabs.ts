import type { Page } from 'playwright';

/**
 * Coverage presents its three dimensions as tabs, so a journey that asserts
 * against pages/endpoints, workflows or declarations selects the one it means.
 * The first is the default and needs no call.
 *
 * Journeys name the dimension, not the label: the visible wording belongs to
 * the design and has already changed once (`Surfaces` was the engine's word
 * for it), and a rename should not be a sweep through sixteen test files.
 */
const labels = {
  surfaces: 'Pages and endpoints',
  workflows: 'Journeys to test',
  declarations: 'In the code',
} as const;

export async function openInventoryTab(page: Page, tab: keyof typeof labels) {
  // Not an exact match: a tab announces its count as part of its name
  // ("In the code 42"), which is worth hearing and is not stable to assert on.
  await page.getByRole('tab', { name: labels[tab] }).click();
  await page.getByRole('tabpanel').first().waitFor();
}
