import { readFile } from 'node:fs/promises';
import { makeFrontendBundle, type FrontendBundle } from './frontend-bundle';
import { packagedWeb } from './runtime';
import { packagedAssets } from './packaged-assets';
export type { FrontendBundle } from './frontend-bundle';
let bundle: Promise<FrontendBundle> | undefined;
/** Compile the React/Tailwind frontend once per server process into one JS and one CSS file. */
export function frontendAssets() {
  bundle ??= (async () => {
    if (packagedWeb) return packagedAssets();
    const { buildFrontend } = await import(
      new URL('./frontend-assets-build.ts', import.meta.url).href
    );
    const result = await buildFrontend();
    const assets = new Map<string, string | Uint8Array>();

    for (const output of Array.isArray(result) ? result : [result]) {
      if (!('output' in output)) throw new Error('Frontend build did not return assets');
      for (const item of output.output) {
        const body = item.type === 'chunk' ? item.code : item.source;
        assets.set(`/${item.fileName}`, body);
      }
    }
    assets.set('/index.html', await readFile(new URL('../public/index.html', import.meta.url)));
    return makeFrontendBundle(assets);
  })().catch((error) => {
    bundle = undefined;
    throw error;
  });
  return bundle;
}
