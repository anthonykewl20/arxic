import type { Project, VisualEnvironment } from './types';

/** Shared capture-budget policy; selection validation happens at project admission. */
export function planVisualMatrix(
  project: Pick<Project, 'browsers' | 'colorSchemes' | 'deviceScaleFactors' | 'viewports'>,
) {
  const environments: VisualEnvironment[] = (project.browsers ?? ['chromium']).flatMap((browser) =>
    (project.colorSchemes ?? ['light']).flatMap((colorScheme) =>
      (project.deviceScaleFactors ?? [1]).map((deviceScaleFactor) => ({
        browser,
        colorScheme,
        ...(deviceScaleFactor === 1 ? {} : { deviceScaleFactor }),
      })),
    ),
  );
  return {
    environments,
    pageBudget: Math.max(1, Math.floor(600 / (project.viewports.length * environments.length))),
  };
}
