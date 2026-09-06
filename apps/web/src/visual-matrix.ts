import type { Project, VisualEnvironment } from './types';

/** Shared capture-budget policy; selection validation happens at project admission. */
export function planVisualMatrix(
  project: Pick<Project, 'browsers' | 'colorSchemes' | 'viewports'>,
) {
  const environments: VisualEnvironment[] = (project.browsers ?? ['chromium']).flatMap((browser) =>
    (project.colorSchemes ?? ['light']).map((colorScheme) => ({ browser, colorScheme })),
  );
  return {
    environments,
    pageBudget: Math.max(1, Math.floor(600 / (project.viewports.length * environments.length))),
  };
}
