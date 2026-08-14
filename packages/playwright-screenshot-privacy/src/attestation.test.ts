import { createHash } from 'node:crypto';
import { access, chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterEach, describe, expect, test } from 'vitest';
import {
  establishTrustedScreenshotCaptureBinding,
  readScreenshotPrivacyAttestation,
  retainPolicyAttestedScreenshots,
  screenshotCaptureReceiptPath,
  screenshotPrivacyAttestationPath,
  screenshotPrivacyRuntimeSource,
  serializeScreenshotPrivacyPolicy,
  validateScreenshotArtifactSet,
  type ScreenshotArtifactLike,
  type TrustedScreenshotCaptureBinding,
} from './index';

const directories: string[] = [];
const expectedScreenshot = 'artifacts/screenshots/home.png';
const expectedSpec = [
  "import { capturePolicyScreenshot } from '../fixtures/screenshot-privacy';",
  "import { test } from '../fixtures/workflow.fixture';",
  "test('safe', async ({ page }) => {",
  `  await capturePolicyScreenshot(page, '${expectedScreenshot}');`,
  '});',
  '',
].join('\n');
const trustedSourceContents = {
  'fixtures/screenshot-privacy.ts': screenshotPrivacyRuntimeSource(),
  'fixtures/workflow.fixture.ts': 'export const test = true;\n',
  'playwright.config.ts': 'export default {};\n',
  'tests/workflow.spec.ts': expectedSpec,
} as const;
const policy = serializeScreenshotPrivacyPolicy({
  schemaVersion: 1,
  id: 'fixture-home-heading',
  authority: {
    kind: 'declared-human-approval',
    reference: 'docs/evidence/M1-SCREENSHOT-PRIVACY/README.md',
    recordedAt: '2026-08-09T12:00:00.000Z',
  },
  capture: {
    mode: 'approved-region',
    region: { kind: 'role', role: 'heading', name: 'Reference Auth App', exact: true },
    masks: [],
  },
});
const correlation = 'correlation-value-0001';

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('trusted screenshot attestation and exact artifact inventory', () => {
  test.each([
    ['missing receipt', async (fixture: Fixture) => rm(fixture.receiptPath)],
    [
      'forged receipt hash',
      async (fixture: Fixture) =>
        rewriteReceipt(fixture.receiptPath, { screenshotSha256: 'f'.repeat(64) }),
    ],
    [
      'forged policy digest',
      async (fixture: Fixture) =>
        rewriteReceipt(fixture.receiptPath, { policySha256: 'f'.repeat(64) }),
    ],
    [
      'forged correlation',
      async (fixture: Fixture) =>
        rewriteReceipt(fixture.receiptPath, { correlationSha256: 'f'.repeat(64) }),
    ],
    [
      'pre-existing authoritative sidecar',
      async (fixture: Fixture) =>
        writeFile(screenshotPrivacyAttestationPath(fixture.pngPath), '{}\n'),
    ],
    [
      'unexpected second raw PNG',
      async (fixture: Fixture) => {
        await writeFile(join(fixture.testDirectory, 'artifacts/screenshots/raw.png'), validPng());
      },
    ],
    [
      'unexpected raw PNG outside declared screenshot roots',
      async (fixture: Fixture) => {
        await writeFile(join(fixture.testDirectory, 'raw-outside-roots.png'), validPng());
      },
    ],
    [
      'unexpected capture receipt outside declared screenshot roots',
      async (fixture: Fixture) => {
        await writeFile(join(fixture.testDirectory, 'forged.capture.json'), '{}\n');
      },
    ],
    [
      'unexpected authoritative sidecar outside declared screenshot roots',
      async (fixture: Fixture) => {
        await writeFile(join(fixture.testDirectory, 'forged.privacy.json'), '{}\n');
      },
    ],
    [
      'unexpected raw PNG written directly into the local dependency directory',
      async (fixture: Fixture) => {
        const path = join(fixture.testDirectory, 'node_modules/raw.png');
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, validPng());
      },
    ],
    [
      'unexpected raw PNG written into local repository metadata',
      async (fixture: Fixture) => {
        const path = join(fixture.testDirectory, '.git/raw.png');
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, validPng());
      },
    ],
  ] as const)(
    'blocks %s, deletes every source image artifact, and publishes nothing',
    async (_label, mutate) => {
      const fixture = await capturedFixture();
      await mutate(fixture);

      await expect(retain(fixture)).rejects.toThrow(/ARXIC-SCREENSHOT-(?:INVENTORY|ATTESTATION)/u);
      await expect(exists(fixture.pngPath)).resolves.toBe(false);
      await expect(exists(fixture.receiptPath)).resolves.toBe(false);
      await expect(imageFiles(fixture.testDirectory)).resolves.toEqual([]);
      await expect(imageFiles(fixture.destinationDirectory)).resolves.toEqual([]);
    },
  );

  test('detects and deletes unexpected PNG bytes disguised with a non-image extension', async () => {
    const fixture = await capturedFixture();
    const disguised = join(fixture.testDirectory, 'artifacts/screenshots/raw.bin');
    await writeFile(disguised, validPng());

    await expect(retain(fixture)).rejects.toThrow(/ARXIC-SCREENSHOT-INVENTORY/u);
    await expect(exists(disguised)).resolves.toBe(false);
    await expect(imageFiles(fixture.destinationDirectory)).resolves.toEqual([]);
  });

  test('detects disguised PNG bytes outside declared screenshot roots', async () => {
    const fixture = await capturedFixture();
    const disguised = join(fixture.testDirectory, 'raw-outside-roots.bin');
    await writeFile(disguised, validPng());

    await expect(retain(fixture)).rejects.toThrow(/ARXIC-SCREENSHOT-INVENTORY/u);
    await expect(exists(disguised)).resolves.toBe(false);
    await expect(imageFiles(fixture.destinationDirectory)).resolves.toEqual([]);
  });

  test('detects and deletes extensionless PNG bytes in a physical local dependency cache', async () => {
    const fixture = await capturedFixture();
    const disguised = join(fixture.testDirectory, 'node_modules/.cache/raw-output');
    await mkdir(dirname(disguised), { recursive: true });
    await writeFile(disguised, validPng());

    await expect(retain(fixture)).rejects.toThrow(/ARXIC-SCREENSHOT-INVENTORY/u);
    await expect(exists(disguised)).resolves.toBe(false);
    await expect(imageFiles(fixture.destinationDirectory)).resolves.toEqual([]);
  });

  test('blocks retained output when an owned-workspace file cannot be inspected', async () => {
    const fixture = await capturedFixture();
    const unreadable = join(fixture.testDirectory, 'unreadable-output.bin');
    await writeFile(unreadable, validPng());
    await chmod(unreadable, 0o000);
    try {
      await expect(retain(fixture)).rejects.toThrow(/ARXIC-SCREENSHOT-INVENTORY/u);
      await expect(imageFiles(fixture.destinationDirectory)).resolves.toEqual([]);
    } finally {
      await chmod(unreadable, 0o600);
    }
  });

  test('rejects source and destination symlink indirection without touching external bytes', async () => {
    const sourceFixture = await capturedFixture();
    const externalPng = join(await temporaryDirectory('arxic-screenshot-external-'), 'outside.png');
    await writeFile(externalPng, validPng());
    await rm(sourceFixture.pngPath);
    await symlink(externalPng, sourceFixture.pngPath);
    await expect(retain(sourceFixture)).rejects.toThrow(/ARXIC-SCREENSHOT-INVENTORY/u);
    await expect(exists(sourceFixture.pngPath)).resolves.toBe(false);
    await expect(exists(externalPng)).resolves.toBe(true);

    const destinationFixture = await capturedFixture();
    const externalDestination = await temporaryDirectory('arxic-screenshot-external-target-');
    await rm(destinationFixture.destinationDirectory, { recursive: true, force: true });
    await symlink(externalDestination, destinationFixture.destinationDirectory);
    await expect(retain(destinationFixture)).rejects.toThrow(/ARXIC-SCREENSHOT-INVENTORY/u);
    await expect(imageFiles(externalDestination)).resolves.toEqual([]);
  });

  test('does not traverse a dependency tree reached only through an external symlink', async () => {
    const fixture = await capturedFixture();
    const externalDependency = await temporaryDirectory('arxic-screenshot-external-dependency-');
    const externalPng = join(externalDependency, 'package-asset.png');
    const dependencyLink = join(fixture.testDirectory, 'node_modules/@playwright/test');
    await writeFile(externalPng, validPng());
    await mkdir(dirname(dependencyLink), { recursive: true });
    await symlink(externalDependency, dependencyLink, 'dir');

    await expect(retain(fixture)).resolves.toHaveLength(1);
    await expect(exists(externalPng)).resolves.toBe(true);
    await expect(exists(dependencyLink)).resolves.toBe(true);
  });

  test('blocks and unlinks an image-named dependency-cache symlink without touching its target', async () => {
    const fixture = await capturedFixture();
    const externalPng = join(
      await temporaryDirectory('arxic-screenshot-external-image-'),
      'asset.png',
    );
    const hiddenLink = join(fixture.testDirectory, 'node_modules/.cache/raw.png');
    await writeFile(externalPng, validPng());
    await mkdir(dirname(hiddenLink), { recursive: true });
    await symlink(externalPng, hiddenLink);

    await expect(retain(fixture)).rejects.toThrow(/ARXIC-SCREENSHOT-INVENTORY/u);
    await expect(exists(hiddenLink)).resolves.toBe(false);
    await expect(exists(externalPng)).resolves.toBe(true);
    await expect(imageFiles(fixture.destinationDirectory)).resolves.toEqual([]);
  });

  test('fails closed when the global image-candidate inventory reaches 257 entries', async () => {
    const fixture = await capturedFixture();
    const candidateDirectory = join(fixture.testDirectory, 'artifacts/overflow');
    // The captured fixture contributes one PNG and one receipt, so these 255 raw
    // candidates cross the exact global limit at artifact 257.
    await writeFiles(candidateDirectory, 255, '.png', validPng());

    await expect(retain(fixture)).rejects.toThrow(/ARXIC-SCREENSHOT-INVENTORY/u);
    await expect(imageFiles(fixture.testDirectory)).resolves.toEqual([]);
    await expect(imageFiles(fixture.destinationDirectory)).resolves.toEqual([]);
  });

  test('fails closed when physical dependency-shaped traversal exceeds 4,096 entries', async () => {
    const fixture = await capturedFixture();
    const dependencyRoot = join(fixture.testDirectory, 'node_modules/.cache');
    const counts = [820, 820, 819, 819, 819] as const;
    for (const [index, count] of counts.entries()) {
      await writeEmptyFiles(join(dependencyRoot, `partition-${index}`), count, '.txt');
    }

    const failure: unknown = await retain(fixture).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: 'ARXIC-SCREENSHOT-INVENTORY-INVALID',
      cause: { code: 'ARXIC-SCREENSHOT-INVENTORY-INVALID' },
    });
    await expect(imageFiles(fixture.testDirectory)).resolves.toEqual([]);
    await expect(imageFiles(fixture.destinationDirectory)).resolves.toEqual([]);
    // Measured 13.6–38.7s locally; 80s is 2× the slowest observed run.
  }, 80_000);

  test('rejects an arbitrary purge root without deleting dependency or trusted-source sentinels', async () => {
    const fixture = await capturedFixture();
    const dependencySentinel = join(fixture.testDirectory, 'node_modules/package/sentinel.txt');
    const trustedSourceSentinel = join(fixture.testDirectory, 'tests/workflow.spec.ts');
    await mkdir(dirname(dependencySentinel), { recursive: true });
    await writeFile(dependencySentinel, 'dependency sentinel\n');

    await expect(
      retainPolicyAttestedScreenshots({
        testDirectory: fixture.testDirectory,
        sourceRoots: ['artifacts', 'node_modules'],
        destinationDirectory: fixture.destinationDirectory,
        binding: fixture.binding,
        policy: policy.policy,
        correlation,
        attester: '@arxic/verifier',
        attestedAt: '2026-08-09T12:02:00.000Z',
      }),
    ).rejects.toThrow(/ARXIC-SCREENSHOT-INVENTORY/u);
    await expect(exists(dependencySentinel)).resolves.toBe(true);
    await expect(exists(trustedSourceSentinel)).resolves.toBe(true);
    await expect(imageFiles(fixture.destinationDirectory)).resolves.toEqual([]);
  });

  test('removes a partially written retained pair when the provenance write fails', async () => {
    const fixture = await capturedFixture();
    await mkdir(join(fixture.destinationDirectory, '001-screenshot.png.privacy.json'));

    await expect(retain(fixture)).rejects.toThrow(/ARXIC-SCREENSHOT-ATTESTATION/u);
    await expect(imageFiles(fixture.destinationDirectory)).resolves.toEqual([]);
    await expect(imageFiles(fixture.testDirectory)).resolves.toEqual([]);
  });

  test('blocks retained output when raw source cleanup cannot complete', async () => {
    const fixture = await capturedFixture();
    const screenshotDirectory = dirname(fixture.pngPath);
    await chmod(screenshotDirectory, 0o500);
    try {
      await expect(retain(fixture)).rejects.toThrow(/ARXIC-SCREENSHOT-INVENTORY/u);
      await expect(imageFiles(fixture.destinationDirectory)).resolves.toEqual([]);
    } finally {
      await chmod(screenshotDirectory, 0o700);
    }
  });

  test('writes action-owned authoritative provenance, removes source bytes, and revalidates the set', async () => {
    const fixture = await capturedFixture();
    const retained = await retain(fixture);

    expect(retained).toHaveLength(1);
    await expect(exists(fixture.pngPath)).resolves.toBe(false);
    await expect(exists(fixture.receiptPath)).resolves.toBe(false);
    const item = retained[0]!;
    expect(item.screenshot.kind).toBe('screenshot');
    expect(item.provenance.kind).toBe('screenshot-privacy-report');
    const attestation = await readScreenshotPrivacyAttestation(item.provenance.path);
    expect(attestation).toMatchObject({
      kind: 'arxic-screenshot-privacy-attestation',
      attestedBy: '@arxic/verifier',
      policySha256: policy.sha256,
      screenshot: {
        file: '001-screenshot.png',
        sha256: item.screenshot.sha256,
        width: 1,
        height: 1,
      },
      binding: {
        spec: fixture.binding.spec,
        runtime: fixture.binding.runtime,
        sources: fixture.binding.sources,
      },
      capture: {
        sourcePath: expectedScreenshot,
      },
    });
    const bindingArtifacts = await boundArtifacts(fixture);
    await expect(
      validateScreenshotArtifactSet({
        artifacts: [...bindingArtifacts, item.screenshot, item.provenance],
      }),
    ).resolves.toBeUndefined();
  });

  test('uses a deterministic numeric retained name without interpreting semantic source words', async () => {
    const fixture = await capturedFixture('artifacts/screenshots/step-change-password-page.png');
    const [item] = await retain(fixture);
    if (!item) throw new Error('retention produced no screenshot');

    expect(basename(item.screenshot.path)).toBe('001-screenshot.png');
    expect(basename(item.provenance.path)).toBe('001-screenshot.png.privacy.json');
  });

  test('rejects a raw screenshot, tampered pixels, and a forged binding independently', async () => {
    const fixture = await capturedFixture();
    const [item] = await retain(fixture);
    if (!item) throw new Error('retention produced no screenshot');
    const bindingArtifacts = await boundArtifacts(fixture);

    await expect(
      validateScreenshotArtifactSet({ artifacts: [...bindingArtifacts, item.screenshot] }),
    ).rejects.toThrow(/ARXIC-SCREENSHOT-ATTESTATION/u);

    await writeFile(
      item.screenshot.path,
      Buffer.concat([validPng(), Buffer.from('PK\u0003\u0004')]),
    );
    const tampered = await artifact('screenshot', item.screenshot.path);
    await expect(
      validateScreenshotArtifactSet({
        artifacts: [...bindingArtifacts, tampered, item.provenance],
      }),
    ).rejects.toThrow(/ARXIC-SCREENSHOT-(?:PNG|ATTESTATION)/u);
  });

  test('rejects a canonical forged authoritative sidecar even when its declared hash is updated', async () => {
    const fixture = await capturedFixture();
    const [item] = await retain(fixture);
    if (!item) throw new Error('retention produced no screenshot');
    const bindingArtifacts = await boundArtifacts(fixture);
    const forged = JSON.parse(await readFile(item.provenance.path, 'utf8')) as {
      binding: { runtime: { sha256: string } };
    };
    forged.binding.runtime.sha256 = 'f'.repeat(64);
    await writeFile(item.provenance.path, canonicalJson(forged));
    const forgedProvenance = await artifact('screenshot-provenance', item.provenance.path);

    await expect(
      validateScreenshotArtifactSet({
        artifacts: [...bindingArtifacts, item.screenshot, forgedProvenance],
      }),
    ).rejects.toThrow(/ARXIC-SCREENSHOT-ATTESTATION/u);
  });

  test('rejects a canonical sidecar that maps numeric output to an unbound source capture', async () => {
    const fixture = await capturedFixture();
    const [item] = await retain(fixture);
    if (!item) throw new Error('retention produced no screenshot');
    const bindingArtifacts = await boundArtifacts(fixture);
    const forged = JSON.parse(await readFile(item.provenance.path, 'utf8')) as {
      capture: { sourcePath: string };
    };
    forged.capture.sourcePath = 'artifacts/screenshots/not-bound.png';
    await writeFile(item.provenance.path, canonicalJson(forged));
    const forgedProvenance = await artifact('screenshot-provenance', item.provenance.path);

    await expect(
      validateScreenshotArtifactSet({
        artifacts: [...bindingArtifacts, item.screenshot, forgedProvenance],
      }),
    ).rejects.toThrow(/ARXIC-SCREENSHOT-ATTESTATION/u);
  });

  test('rejects an untrusted capture receipt in a promotion artifact inventory', async () => {
    const fixture = await capturedFixture();
    const [item] = await retain(fixture);
    if (!item) throw new Error('retention produced no screenshot');
    const untrustedReceiptPath = join(fixture.destinationDirectory, 'leaked.CAPTURE.JSON');
    await writeFile(untrustedReceiptPath, '{}\n');
    const untrustedReceipt = await artifact('bundle-file', untrustedReceiptPath);

    await expect(
      validateScreenshotArtifactSet({
        artifacts: [
          ...(await boundArtifacts(fixture)),
          item.screenshot,
          item.provenance,
          untrustedReceipt,
        ],
      }),
    ).rejects.toThrow(/ARXIC-SCREENSHOT-ATTESTATION/u);
  });

  test('rejects duplicate screenshot and provenance paths in an artifact inventory', async () => {
    const fixture = await capturedFixture();
    const [item] = await retain(fixture);
    if (!item) throw new Error('retention produced no screenshot');

    await expect(
      validateScreenshotArtifactSet({
        artifacts: [
          ...(await boundArtifacts(fixture)),
          item.screenshot,
          item.provenance,
          item.screenshot,
          item.provenance,
        ],
      }),
    ).rejects.toThrow(/ARXIC-SCREENSHOT-ATTESTATION/u);
  });
});

type Fixture = {
  testDirectory: string;
  destinationDirectory: string;
  binding: TrustedScreenshotCaptureBinding;
  pngPath: string;
  receiptPath: string;
};

async function capturedFixture(relativeScreenshot = expectedScreenshot): Promise<Fixture> {
  const testDirectory = await temporaryDirectory('arxic-screenshot-attestation-source-');
  const destinationDirectory = await temporaryDirectory('arxic-screenshot-attestation-target-');
  const fixtureSpec = expectedSpec.replace(expectedScreenshot, relativeScreenshot);
  const fixtureSourceContents = {
    ...trustedSourceContents,
    'tests/workflow.spec.ts': fixtureSpec,
  };
  await Promise.all([
    put(testDirectory, 'tests/workflow.spec.ts', fixtureSpec),
    put(testDirectory, 'fixtures/screenshot-privacy.ts', screenshotPrivacyRuntimeSource()),
    put(testDirectory, 'fixtures/workflow.fixture.ts', 'export const test = true;\n'),
    put(testDirectory, 'playwright.config.ts', 'export default {};\n'),
  ]);
  const binding = await establishTrustedScreenshotCaptureBinding({
    testDirectory,
    specPath: 'tests/workflow.spec.ts',
    runtimePath: 'fixtures/screenshot-privacy.ts',
    expectedSpec: fixtureSpec,
    allowedSourcePaths: [
      'tests/workflow.spec.ts',
      'fixtures/screenshot-privacy.ts',
      'fixtures/workflow.fixture.ts',
      'playwright.config.ts',
    ],
    trustedSourceContents: fixtureSourceContents,
    expectedScreenshots: [relativeScreenshot],
  });
  const pngPath = join(testDirectory, relativeScreenshot);
  const receiptPath = screenshotCaptureReceiptPath(pngPath);
  await mkdir(dirname(pngPath), { recursive: true });
  const bytes = validPng();
  await writeFile(pngPath, bytes);
  await writeFile(
    receiptPath,
    canonicalJson({
      schemaVersion: 1,
      kind: 'arxic-untrusted-screenshot-capture',
      screenshotFile: basename(pngPath),
      screenshotSha256: sha256(bytes),
      screenshotBytes: bytes.length,
      policySha256: policy.sha256,
      correlationSha256: sha256(correlation),
      captureMode: 'approved-region',
      playwrightVersion: '1.62.1',
      browserVersion: '140.0.0.0',
      capturedAt: '2026-08-09T12:01:00.000Z',
    }),
  );
  return { testDirectory, destinationDirectory, binding, pngPath, receiptPath };
}

async function retain(fixture: Fixture) {
  return retainPolicyAttestedScreenshots({
    testDirectory: fixture.testDirectory,
    sourceRoots: ['artifacts', 'test-results'],
    destinationDirectory: fixture.destinationDirectory,
    binding: fixture.binding,
    policy: policy.policy,
    correlation,
    attester: '@arxic/verifier',
    attestedAt: '2026-08-09T12:02:00.000Z',
  });
}

async function rewriteReceipt(path: string, fields: Record<string, unknown>): Promise<void> {
  const current = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  await writeFile(path, canonicalJson({ ...current, ...fields }));
}

async function artifact(kind: string, path: string): Promise<ScreenshotArtifactLike> {
  return { kind, path, sha256: sha256(await readFile(path)) };
}

async function boundArtifacts(fixture: Fixture): Promise<ScreenshotArtifactLike[]> {
  return Promise.all(
    fixture.binding.sources.map(({ path }) =>
      artifact('playwright-source', join(fixture.testDirectory, path)),
    ),
  );
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  directories.push(path);
  return path;
}

async function put(directory: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(directory, path)), { recursive: true });
  await writeFile(join(directory, path), content, 'utf8');
}

async function writeEmptyFiles(directory: string, count: number, extension: string): Promise<void> {
  await writeFiles(directory, count, extension, '');
}

async function writeFiles(
  directory: string,
  count: number,
  extension: string,
  content: string | Uint8Array,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  for (let start = 0; start < count; start += 128) {
    await Promise.all(
      Array.from({ length: Math.min(128, count - start) }, (_unused, index) =>
        writeFile(
          join(directory, `${String(start + index).padStart(4, '0')}${extension}`),
          content,
        ),
      ),
    );
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function imageFiles(directory: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  async function walk(path: string): Promise<string[]> {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return (
        await Promise.all(
          entries.map((entry) => {
            const child = join(path, entry.name);
            return entry.isDirectory() ? walk(child) : Promise.resolve([child]);
          }),
        )
      ).flat();
    } catch {
      return [];
    }
  }
  return (await walk(directory)).filter((path) =>
    /\.(?:png|jpe?g|webp)(?:\.(?:capture|privacy)\.json)?$/u.test(path),
  );
}

function validPng(): Buffer {
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr()),
    chunk('IDAT', deflateSync(Buffer.from([0, 0x11, 0x22, 0x33]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ihdr(): Buffer {
  const bytes = Buffer.alloc(13);
  bytes.writeUInt32BE(1, 0);
  bytes.writeUInt32BE(1, 4);
  bytes[8] = 8;
  bytes[9] = 2;
  return bytes;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
