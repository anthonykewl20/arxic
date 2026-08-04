import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateEvidenceRef, validateManifest, validateWorkflow } from '@arxic/contracts';
import { describe, expect, it } from 'vitest';
import { BundlePromoterAdapter, freezeBundle } from '..';
import { stagedBundle } from './bundle-fixture';

describe('real filesystem promotion of a prior-slice auth bundle', () => {
  it('proves canonical hashes, determinism, LKG, and failure preservation', async () => {
    const rootA = await mkdtemp(join(tmpdir(), 'arxic-promotion-real-a-'));
    const rootB = await mkdtemp(join(tmpdir(), 'arxic-promotion-real-b-'));
    const publicA = join(rootA, 'authentication-login.bundle');
    const publicB = join(rootB, 'authentication-login.bundle');
    const first = await stagedBundle('real-reference-login-1');
    expect(validateManifest(first.manifest)).toMatchObject({ ok: true });
    expect(validateWorkflow(first.workflow)).toMatchObject({ ok: true });
    for (const evidence of Object.values(first.evidenceIndex)) {
      expect(validateEvidenceRef(evidence)).toMatchObject({ ok: true });
    }
    const firstReceipt = await new BundlePromoterAdapter({ publicPath: publicA }).promote(first, [
      { gate: 'delivery', passed: true },
    ]);
    const publicFirst = await readFile(publicA);
    expect(publicFirst).toEqual(freezeBundle(first));
    expect(firstReceipt.checksumSha256).toBe(
      createHash('sha256').update(publicFirst).digest('hex'),
    );
    await new BundlePromoterAdapter({ publicPath: publicB }).promote(first, [
      { gate: 'delivery', passed: true },
    ]);
    expect(await readFile(publicB)).toEqual(publicFirst);

    const second = await stagedBundle('real-reference-login-2');
    second.plan += '\nSecond observed reference run.\n';
    await new BundlePromoterAdapter({ publicPath: publicA }).promote(second, [
      { gate: 'delivery', passed: true },
    ]);
    const publicSecond = await readFile(publicA);
    expect(publicSecond).toEqual(freezeBundle(second));
    expect(await readFile(`${publicA}.lkg`)).toEqual(publicFirst);

    await unlink(`${publicA}.lkg`);
    await mkdir(`${publicA}.lkg`);
    const third = await stagedBundle('real-reference-login-3');
    const failed = await new BundlePromoterAdapter({ publicPath: publicA }).promoteWithDiagnostics(
      third,
      [{ gate: 'delivery', passed: true }],
    );
    expect(failed).toMatchObject({
      diagnostics: [{ code: 'ARXIC-PROMOTION-ATOMIC-REPLACE-FAILED', severity: 'blocked' }],
    });
    expect(await readFile(publicA)).toEqual(publicSecond);
  });
});
