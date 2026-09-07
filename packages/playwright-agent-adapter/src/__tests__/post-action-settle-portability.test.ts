import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { postActionSettleRuntimeSource } from '../post-action-settle';

it('keeps independently bundled runtime bytes identical to the source verifier', async () => {
  const cliRequire = createRequire(new URL('../../../../apps/cli/package.json', import.meta.url));
  // Use the CLI's real bundler dependency; no fake transformer or Arxic service.
  const { buildSync } = createRequire(cliRequire.resolve('tsup'))('esbuild');
  const directory = await mkdtemp(join(tmpdir(), 'arxic-settle-portability-'));
  try {
    const output = join(directory, 'runtime.cjs');
    buildSync({
      entryPoints: [fileURLToPath(new URL('../post-action-settle.ts', import.meta.url))],
      bundle: true,
      minify: true,
      platform: 'node',
      format: 'cjs',
      outfile: output,
    });
    const packed = cliRequire(output) as { postActionSettleRuntimeSource(): string };
    expect(packed.postActionSettleRuntimeSource()).toBe(postActionSettleRuntimeSource());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
