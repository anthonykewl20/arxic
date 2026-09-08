import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createIntakeQueue } from './intake';
import { freeReserveOk } from './retention';

const statfsLike = (availableBytes: number) => async () => ({
  bsize: 4096,
  blocks: Math.ceil(availableBytes / 4096) + 10,
  bfree: Math.ceil(availableBytes / 4096) + 10,
  bavail: Math.floor(availableBytes / 4096),
  files: 1000,
  ffree: 1000,
});

const validManifest = {
  version: 1,
  id: 'case',
  group: 'g',
  revision: 'a'.repeat(40),
  consent: true,
  context: { width: 800, height: 600, dpr: 1, profile: 'p', state: 's' },
  before: { path: 'b.png', sha256: '0'.repeat(64) },
  current: { path: 'c.png', sha256: '0'.repeat(64) },
  beforePrivacy: { path: 'bp.json', sha256: '0'.repeat(64) },
  currentPrivacy: { path: 'cp.json', sha256: '0'.repeat(64) },
  scene: { path: 's.json', sha256: '0'.repeat(64) },
  timeline: { path: 't.json', sha256: '0'.repeat(64) },
  timelineProvenance: { path: 'tp.json', sha256: '0'.repeat(64) },
};

it('refuses admission before the free reserve is breached and fails closed on stat errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'visual-reserve-'));
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'case.json'), JSON.stringify(validManifest));
    const refused = createIntakeQueue({
      root: dir,
      execute: async () => ({}),
      freeReserve: { path: dir, minFreeBytes: 1024, statfs: statfsLike(512) },
    });
    await expect(refused.submit({ casePath: 'case.json' })).resolves.toMatchObject({
      accepted: false,
      reason: 'disk-reserve-breach',
    });
    // The refusal consumed no queue slot: a healthy reserve admits afterwards.
    const healthy = createIntakeQueue({
      root: dir,
      execute: async () => ({}),
      freeReserve: { path: dir, minFreeBytes: 512, statfs: statfsLike(1 << 20) },
    });
    const admitted = await healthy.submit({ casePath: 'case.json' });
    expect(admitted).toMatchObject({ accepted: true });
    // statfs failure fails closed: admission refused, never guessed open.
    const blinded = createIntakeQueue({
      root: dir,
      execute: async () => ({}),
      freeReserve: {
        path: dir,
        minFreeBytes: 512,
        statfs: async () => {
          throw new Error('stat-unavailable');
        },
      },
    });
    await expect(blinded.submit({ casePath: 'case.json' })).resolves.toMatchObject({
      accepted: false,
      reason: 'disk-reserve-unavailable',
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('measures the real filesystem when no statfs is injected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'visual-reserve-real-'));
  try {
    const tiny = await freeReserveOk(dir, 1);
    expect(tiny.ok).toBe(true);
    expect(tiny.availableBytes).toBeGreaterThan(0);
    const impossible = await freeReserveOk(dir, Number.MAX_SAFE_INTEGER);
    expect(impossible.ok).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
