import { build } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

let bundle: Promise<Map<string, string | Uint8Array>> | undefined;
/** Compile local React/shadcn assets once per server process; never serves source or remote scripts. */
export function frontendAssets() {
  bundle ??= (async () => {
    const result = await build({
      configFile: false,
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      root: fileURLToPath(new URL('../', import.meta.url)),
      publicDir: false,
      logLevel: 'silent',
      plugins: [tailwindcss()],
      esbuild: { jsx: 'automatic', jsxDev: false },
      build: {
        write: false,
        minify: true,
        lib: {
          entry: fileURLToPath(new URL('./frontend/provider-panel.tsx', import.meta.url)),
          formats: ['es'],
          fileName: () => 'provider-ui.js',
          cssFileName: 'provider-ui',
        },
        rollupOptions: { output: { inlineDynamicImports: true } },
      },
    });
    const assets = new Map<string, string | Uint8Array>();
    for (const output of Array.isArray(result) ? result : [result]) {
      if (!('output' in output)) throw new Error('Frontend build did not return assets');
      for (const item of output.output)
        assets.set(`/${item.fileName}`, item.type === 'chunk' ? item.code : item.source);
    }
    return assets;
  })().catch((error) => {
    bundle = undefined;
    throw error;
  });
  return bundle;
}
