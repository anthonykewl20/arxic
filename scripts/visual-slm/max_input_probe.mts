// Maximum-accepted-input probe (refs #423, spec 6/13): constructs a VALID case
// at the exact intake bounds (2048x1024 pair at the 2,097,152-pixel ceiling, 128 regions,
// scene) and drives the real review path under a constrained container. Scope:
// decode + feature extraction + inference memory/latency at the ceiling; no
// browser/server/OS. Scratch case is written under /out and is synthetic
// geometry — resource evidence only, never corpus or quality data.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import sharp from '/repo/apps/web/node_modules/sharp/dist/index.cjs';
import { reviewCase } from '/repo/apps/web/src/compact-visual/model';

const out = '/out/max-input-case';
const cgroup = async (file: string) => (await readFile(`/sys/fs/cgroup/${file}`, 'utf8')).trim();
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const size = 2048;
const height = 1024; // 2048x1024 = exactly the 2,097,152 decoded-pixel ceiling
// Retained-evidence PNGs must not carry a pHYs chunk; sharp emits one, so the
// probe strips it chunk-wise before hashing.
const stripPhys = (png: Buffer): Buffer => {
  const chunks: Buffer[] = [png.subarray(0, 8)];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (type !== 'pHYs') chunks.push(png.subarray(offset, end));
    offset = end;
  }
  return Buffer.concat(chunks);
};

try {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true, mode: 0o700 });
  // Compressed well under the 4 MiB intake bound while decoding to the full
  // 2048x1024x4 buffers (8.4 MiB per image).
  const beforePng = stripPhys(
    await sharp({
      create: { width: size, height, channels: 4, background: { r: 64, g: 48, b: 96, alpha: 1 } },
    })
      .png()
      .toBuffer(),
  );
  const currentPng = stripPhys(
    await sharp({
      create: { width: size, height, channels: 4, background: { r: 96, g: 48, b: 64, alpha: 1 } },
    })
      .png()
      .toBuffer(),
  );
  const write = async (name: string, bytes: Buffer) => {
    await writeFile(`${out}/${name}`, bytes, { mode: 0o600, flag: 'wx' });
    return { path: name, sha256: sha256(bytes) };
  };
  const before = await write('before.png', beforePng);
  const current = await write('current.png', currentPng);
  const privacyBytes = Buffer.from(
    JSON.stringify({
      version: 1,
      screenshotSha256: before.sha256,
      mode: 'input-masked',
      masks: [],
      rawTraceRetained: false,
    }),
  );
  const beforePrivacy = await write('before.png.privacy.json', privacyBytes);
  const currentPrivacy = await write(
    'current.png.privacy.json',
    Buffer.from(
      JSON.stringify({
        version: 1,
        screenshotSha256: current.sha256,
        mode: 'input-masked',
        masks: [],
        rawTraceRetained: false,
      }),
    ),
  );
  const regions = Array.from({ length: 128 }, (_, index) => ({
    id: `region-${index}`,
    box: { x: index * 16, y: 0, width: 16, height },
    before: { box: null, clip: null, hit: null, overflowX: null, overflowY: null },
    current: { box: null, clip: null, hit: null, overflowX: null, overflowY: null },
    eligible: [false, false, false, false, false, false],
    criterion: 'required-submit-inside-viewport',
  }));
  const sceneValue = {
    version: 1,
    beforeSha256: before.sha256,
    currentSha256: current.sha256,
    sanitized: true,
    stable: true,
    regions,
    hardChecks: [] as unknown[],
  };
  const scene = await write('scene.json', Buffer.from(JSON.stringify(sceneValue)));
  const timeline = await write(
    'timeline.json',
    Buffer.from(
      JSON.stringify({ version: 1, actions: ['capture-before', 'capture-current', 'measure'] }),
    ),
  );
  const timelineProvenance = await write(
    'timeline.sanitization.json',
    Buffer.from(
      JSON.stringify({
        version: 1,
        sha256: timeline.sha256,
        method: 'allowlisted-actions-v1',
        rawTraceRetained: false,
      }),
    ),
  );
  const manifest = {
    version: 1,
    id: 'max-input',
    group: 'synthetic-bounds',
    revision: 'a'.repeat(40),
    consent: true,
    context: { width: size, height, dpr: 1, profile: 'synthetic-bounds', state: 'resource-probe' },
    before,
    current,
    beforePrivacy,
    currentPrivacy,
    scene,
    timeline,
    timelineProvenance,
  };
  await write('case.json', Buffer.from(JSON.stringify(manifest)));
  // The review path resolves model + artifact relative to the case root.
  await mkdir(`${out}/training`, { recursive: true });
  await writeFile(`${out}/mlp-model.json`, await readFile('/data/mlp-model.json'), { flag: 'wx' });
  await writeFile(`${out}/training/mlp.bin`, await readFile('/data/training/mlp.bin'), {
    flag: 'wx',
  });
  const started = performance.now();
  const report = await reviewCase(out, 'case.json', 'mlp-model.json', '/data/visual-native');
  const elapsed = performance.now() - started;
  console.log(
    JSON.stringify(
      {
        scope:
          'max-accepted-input bounds through the real review path; synthetic geometry; no browser/server/OS',
        inputPair: [`${size}x${height}`, `${size}x${height}`],
        compressedBytes: [beforePng.length, currentPng.length],
        regions: regions.length,
        elapsedMs: Math.round(elapsed),
        modelStatus: report.modelStatus,
        diagnostic: report.diagnostic,
        coverage: report.coverage,
        memoryPeakBytes: Number(await cgroup('memory.peak')),
        memoryMax: await cgroup('memory.max'),
        cpuMax: await cgroup('cpu.max'),
        memoryEvents: await cgroup('memory.events'),
        vpsQualified: false,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(out, { recursive: true, force: true });
}
