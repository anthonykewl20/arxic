import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'tsup';

const screenshotRuntimePath = resolve(
  import.meta.dirname,
  '../../packages/playwright-screenshot-privacy/src/standalone-runtime.ts',
);

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  bundle: true,
  clean: true,
  splitting: false,
  sourcemap: false,
  minify: false,
  esbuildPlugins: [
    {
      name: 'bundle-screenshot-runtime-source',
      setup(build) {
        build.onLoad({ filter: /playwright-screenshot-privacy\/src\/runtime-source\.ts$/ }, () => ({
          contents: `export function screenshotPrivacyRuntimeSource() { return ${JSON.stringify(readFileSync(screenshotRuntimePath, 'utf8'))}; }`,
          loader: 'js',
        }));
      },
    },
  ],
  noExternal: [/^@arxic\//],
  external: [
    /^@ast-grep\/cli(?:\/.*)?$/,
    /^@playwright\/test(?:\/.*)?$/,
    /^chromium-bidi(?:\/.*)?$/,
    /^crawlee(?:\/.*)?$/,
    /^playwright(?:-core)?(?:\/.*)?$/,
    /^testcontainers(?:\/.*)?$/,
    /^tree-sitter(?:-javascript|-typescript)?(?:\/.*)?$/,
    /^yauzl(?:\/.*)?$/,
    /^yazl(?:\/.*)?$/,
  ],
});
