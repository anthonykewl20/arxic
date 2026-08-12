import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARXIC_PROMOTION_REDACTION_FAILED, BundlePromoterAdapter, freezeBundle } from '..';
import { stagedBundle } from './bundle-fixture';

async function promotionFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-redaction-promotion-'));
  return { publicPath: join(directory, 'bundle.json') };
}

describe('promotion redaction gate', () => {
  it('blocks a secret in the frozen bundle and preserves prior public bytes', async () => {
    const { publicPath } = await promotionFixture();
    const prior = Buffer.from('prior promoted bundle');
    await writeFile(publicPath, prior);
    const bundle = await stagedBundle('planted-secret');
    bundle.plan += '\nAuthorization: Bearer eyJhbGciOiJIUzI1NiJ9.authentication-payload\n';

    const result = await new BundlePromoterAdapter({ publicPath }).promoteWithDiagnostics(bundle, [
      { gate: 'delivery', passed: true },
    ]);

    expect(result.receipt).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ARXIC_PROMOTION_REDACTION_FAILED,
          severity: 'blocked',
        }),
      ]),
    );
    expect(await readFile(publicPath)).toEqual(prior);
  });

  it('allows process.env and ARXIC_INPUT references in the frozen bundle', async () => {
    const { publicPath } = await promotionFixture();
    const bundle = await stagedBundle('allowlisted-inputs');
    bundle.plan +=
      '\npassword = process.env.ARXIC_INPUT_PASSWORD\napiKey = process.env["ARXIC_INPUT_API_KEY"]\n';

    const result = await new BundlePromoterAdapter({ publicPath }).promoteWithDiagnostics(bundle, [
      { gate: 'delivery', passed: true },
    ]);

    expect(result.receipt).toBeDefined();
    expect(result.diagnostics).toEqual([]);
    expect(await readFile(publicPath)).toEqual(freezeBundle(bundle));
  });

  it('still promotes a clean staged bundle', async () => {
    const { publicPath } = await promotionFixture();
    const bundle = await stagedBundle('clean-redaction-control');

    const result = await new BundlePromoterAdapter({ publicPath }).promoteWithDiagnostics(bundle, [
      { gate: 'delivery', passed: true },
    ]);

    expect(result.receipt).toBeDefined();
    expect(result.diagnostics).toEqual([]);
    expect(await readFile(publicPath)).toEqual(freezeBundle(bundle));
  });
});
