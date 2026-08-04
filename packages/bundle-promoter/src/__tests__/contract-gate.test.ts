import type { BundlePromoter, PromotionReceipt } from '@arxic/contracts';
import { validateDiagnostic, validateManifest } from '@arxic/contracts';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as exports from '..';
import { BundlePromoterAdapter, PROMOTION_DIAGNOSTIC_CODES } from '..';
import { stagedBundle } from './bundle-fixture';

describe('ADR §23.14 BundlePromoter contract gate', () => {
  it('honors the frozen interface and returns the exact receipt shape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'arxic-promotion-contract-'));
    const promoter: BundlePromoter = new BundlePromoterAdapter({
      publicPath: join(root, 'bundle.json'),
      now: () => '2026-08-05T13:00:00.000Z',
    });
    const receipt: PromotionReceipt = await promoter.promote(await stagedBundle(), [
      { gate: 'delivery', passed: true },
    ]);
    expect(Object.keys(receipt).sort()).toEqual([
      'checksumSha256',
      'location',
      'manifest',
      'promotedAt',
    ]);
    expect(receipt).toMatchObject({
      promotedAt: '2026-08-05T13:00:00.000Z',
      checksumSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(validateManifest(receipt.manifest)).toMatchObject({ ok: true });
  });

  it('loop-closes every exported ARXIC-PROMOTION code', () => {
    const codes = (Object.values(exports) as unknown[]).filter(
      (value): value is string => typeof value === 'string' && value.startsWith('ARXIC-PROMOTION-'),
    );
    expect(codes.sort()).toEqual([...PROMOTION_DIAGNOSTIC_CODES].sort());
    for (const code of codes) {
      expect(
        validateDiagnostic({
          code,
          severity: 'blocked',
          subject: 'contract-gate',
          message: 'test',
        }),
      ).toMatchObject({ ok: true });
    }
  });
});
