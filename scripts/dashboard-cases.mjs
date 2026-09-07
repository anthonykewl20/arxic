const allCases = [
  'apps/web/src/__tests__/ui.real-world.test.ts',
  'apps/web/src/__tests__/dashboard-ux.real-world.test.ts',
  'apps/web/src/__tests__/dashboard-readability.real-world.test.ts',
  'apps/web/src/__tests__/campaign-ui.real-world.test.ts',
  'apps/web/src/__tests__/restart.real-world.test.ts',
  'apps/web/src/__tests__/element-kinds.real-world.test.ts',
  'apps/web/src/__tests__/visual-matrix-ui.real-world.test.ts',
  'apps/web/src/__tests__/visual-density-ui.real-world.test.ts',
  'apps/web/src/__tests__/capture-gallery-ui.real-world.test.ts',
  'apps/web/src/__tests__/capture-failures.real-world.test.ts',
  'apps/web/src/__tests__/provider-ui.real-world.test.ts',
  'apps/web/src/__tests__/visual-review-ui.real-world.test.ts',
  'apps/web/src/__tests__/retention-ui.real-world.test.ts',
  'apps/web/src/__tests__/baseline-history-ui.real-world.test.ts',
  'apps/web/src/__tests__/contrast-ui.real-world.test.ts',
  'apps/web/src/__tests__/capture-write-isolation.real-world.test.ts',
  'apps/web/src/__tests__/frontend-template.real-world.test.ts',
];

/** Two exhaustive installed-dashboard partitions; ordinary/full release runs retain every file. */
export function installedDashboardCases({ dashboardOnly = false, shard } = {}) {
  if (shard !== undefined && (!dashboardOnly || !['1', '2'].includes(shard)))
    throw new Error('Invalid dashboard shard selection');
  return shard === undefined
    ? [...allCases]
    : allCases.filter((_file, index) => index % 2 === Number(shard) - 1);
}
