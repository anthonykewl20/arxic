import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'tsup';

const packageJson = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8'),
) as { version: string };

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  bundle: true,
  clean: true,
  splitting: false,
  sourcemap: false,
  minify: false,
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __arxicCreateRequire } from 'node:module'; const require = __arxicCreateRequire(import.meta.url); const __dirname = import.meta.dirname; const __filename = import.meta.filename;",
  },
  footer: {
    js: 'runCli(process.argv.slice(2)).then((result) => { process.exitCode = result.exitCode; });',
  },
  define: {
    'process.env.ARXIC_VERSION': JSON.stringify(packageJson.version),
  },
  noExternal: [/^@arxic\//],
  external: [
    /^@ast-grep\/cli(?:\/.*)?$/,
    /^@playwright\/test(?:\/.*)?$/,
    /^chromium-bidi(?:\/.*)?$/,
    /^crawlee(?:\/.*)?$/,
    /^playwright(?:-core)?(?:\/.*)?$/,
    /^testcontainers(?:\/.*)?$/,
    /^tree-sitter(?:-javascript|-typescript)?(?:\/.*)?$/,
  ],
});
