import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { StagedBundle } from '@arxic/contracts';
import { describe, expect, it } from 'vitest';
import {
  ARXIC_PROMOTION_ATOMIC_REPLACE_FAILED,
  ARXIC_PROMOTION_GATE_FAILED,
  ARXIC_PROMOTION_HASH_MISMATCH,
  ARXIC_PROMOTION_LOCK_CONTENTION,
  ARXIC_PROMOTION_VALIDATION_FAILED,
  atomicReplace,
  BundlePromoterAdapter,
  freezeBundle,
  PromotionError,
} from '..';
import { stagedBundle } from './bundle-fixture';

async function promotionPath() {
  const root = await mkdtemp(join(tmpdir(), 'arxic-promotion-sad-'));
  return join(root, 'bundle.json');
}

describe('promotion sad paths map to blocked', () => {
  it('preserves the prior public bundle when the LKG snapshot fails before replace', async () => {
    const publicPath = await promotionPath();
    const prior = Buffer.from('prior promoted bundle');
    await writeFile(publicPath, prior);
    await mkdir(`${publicPath}.lkg`);
    const result = await new BundlePromoterAdapter({ publicPath }).promoteWithDiagnostics(
      await stagedBundle(),
      [{ gate: 'execution', passed: true }],
    );
    expect(result.receipt).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe(ARXIC_PROMOTION_ATOMIC_REPLACE_FAILED);
    expect(await readFile(publicPath)).toEqual(prior);
  });

  it('blocks a post-freeze staged-byte hash mismatch before public replace', async () => {
    const publicPath = await promotionPath();
    const prior = Buffer.from('prior promoted bundle');
    await writeFile(publicPath, prior);
    const frozen = freezeBundle(await stagedBundle());
    const wrongHash = createHash('sha256').update('different bytes').digest('hex');
    const result = await atomicReplace(publicPath, frozen, wrongHash);
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: ARXIC_PROMOTION_HASH_MISMATCH, severity: 'blocked' }],
    });
    expect(await readFile(publicPath)).toEqual(prior);
  });

  it('blocks an AJV-invalid staged manifest without replacing public bytes', async () => {
    const publicPath = await promotionPath();
    const prior = Buffer.from('prior promoted bundle');
    await writeFile(publicPath, prior);
    const bundle = await stagedBundle();
    const malformed = {
      ...bundle,
      manifest: { ...bundle.manifest, commit: 'short' },
    } as unknown as StagedBundle;
    const result = await new BundlePromoterAdapter({ publicPath }).promoteWithDiagnostics(
      malformed,
      [{ gate: 'schema', passed: true }],
    );
    expect(result).toMatchObject({
      diagnostics: [{ code: ARXIC_PROMOTION_VALIDATION_FAILED, severity: 'blocked' }],
    });
    expect(await readFile(publicPath)).toEqual(prior);
  });

  it('blocks a concurrent contender and leaves one complete canonical bundle', async () => {
    const publicPath = await promotionPath();
    const first = await stagedBundle('concurrent-1');
    const second = await stagedBundle('concurrent-2');
    first.plan += 'x'.repeat(256 * 1024);
    second.plan += 'y'.repeat(256 * 1024);
    const results = await Promise.all(
      [first, second].map((bundle) =>
        new BundlePromoterAdapter({ publicPath }).promoteWithDiagnostics(bundle, [
          { gate: 'execution', passed: true },
        ]),
      ),
    );
    expect(results.filter((result) => result.receipt)).toHaveLength(1);
    expect(results.filter((result) => !result.receipt)[0]?.diagnostics[0]?.code).toBe(
      ARXIC_PROMOTION_LOCK_CONTENTION,
    );
    const publicBytes = await readFile(publicPath);
    expect([freezeBundle(first), freezeBundle(second)]).toContainEqual(publicBytes);
  });

  it('blocks a failed gate before any filesystem write', async () => {
    const publicPath = await promotionPath();
    const adapter = new BundlePromoterAdapter({ publicPath });
    const result = await adapter.promoteWithDiagnostics(await stagedBundle(), [
      { gate: 'execution', passed: false },
    ]);
    expect(result).toMatchObject({
      diagnostics: [{ code: ARXIC_PROMOTION_GATE_FAILED, severity: 'blocked' }],
    });
    await expect(readFile(publicPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      adapter.promote(await stagedBundle(), [{ gate: 'execution', passed: false }]),
    ).rejects.toBeInstanceOf(PromotionError);
  });
});
