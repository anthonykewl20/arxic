import { build } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
export async function buildFrontend() {
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
  return result;
}
