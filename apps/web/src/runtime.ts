import { fileURLToPath } from 'node:url';
declare const __ARXIC_PACKAGED_WEB__: boolean;
/** Build-time selection; environment variables cannot switch execution layouts. */
export const packagedWeb = typeof __ARXIC_PACKAGED_WEB__ !== 'undefined' && __ARXIC_PACKAGED_WEB__;
export const jobFile = fileURLToPath(
  new URL(packagedWeb ? './web-job.js' : './job.ts', import.meta.url),
);
export const rulepacksDirectory = fileURLToPath(
  new URL(packagedWeb ? '../rulepacks/' : '../../../rulepacks/', import.meta.url),
);
export const assetDirectory = fileURLToPath(new URL('./web-assets/', import.meta.url));
