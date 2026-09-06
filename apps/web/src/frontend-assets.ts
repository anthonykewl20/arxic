import { build } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export type FrontendBundle = {
  assets: Map<string, string | Uint8Array>;
  /** Content hash shared by every asset; index.html references it for immutable caching. */
  version: string;
};
let bundle: Promise<FrontendBundle> | undefined;
/** Compile the React/Tailwind frontend once per server process into one JS and one CSS file. */
export function frontendAssets() {
  bundle ??= (async () => {
    const result = await build({
      configFile: false,
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      root: fileURLToPath(new URL('../', import.meta.url)),
      publicDir: false,
      logLevel: 'silent',
      plugins: [tailwindcss()],
      esbuild: { jsx: 'automatic', jsxDev: false, legalComments: 'none' },
      build: {
        write: false,
        minify: true,
        target: 'es2022',
        cssMinify: true,
        lib: {
          entry: fileURLToPath(new URL('./frontend/main.tsx', import.meta.url)),
          formats: ['es'],
          fileName: () => 'app.js',
          cssFileName: 'app',
        },
        rollupOptions: { output: { inlineDynamicImports: true } },
      },
    });
    const assets = new Map<string, string | Uint8Array>();
    const hash = createHash('sha256');
    for (const output of Array.isArray(result) ? result : [result]) {
      if (!('output' in output)) throw new Error('Frontend build did not return assets');
      for (const item of output.output) {
        const body = item.type === 'chunk' ? item.code : item.source;
        assets.set(`/${item.fileName}`, body);
        hash.update(item.fileName).update(body);
      }
    }
    if (!assets.has('/app.js') || !assets.has('/app.css'))
      throw new Error('Frontend build must produce app.js and app.css');
    return { assets, version: hash.digest('hex').slice(0, 16) };
  })().catch((error) => {
    bundle = undefined;
    throw error;
  });
  return bundle;
}
