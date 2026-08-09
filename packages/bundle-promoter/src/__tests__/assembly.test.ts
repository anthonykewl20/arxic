import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateDiagnostic } from '@arxic/contracts';
import type { ArtifactRef, StagedBundle } from '@arxic/contracts';
import { describe, expect, it } from 'vitest';
import { ZipFile } from 'yazl';
import { sanitizePlaywrightTrace } from '@arxic/playwright-trace-sanitizer';
import { ARXIC_PROMOTION_REDACTION_FAILED, assembleBundle, scanBundleForSensitiveData } from '..';
import { stagedBundle } from './bundle-fixture';

describe('bundle assembly and redaction gate', () => {
  it('blocks real email addresses in text artifacts', async () => {
    const directory = await textBundle('account=user@real-company.com');
    const result = await scanBundleForSensitiveData(directory);
    expect(result).toMatchObject({
      passed: false,
      findings: [{ file: 'artifact.txt', pattern: 'email-address' }],
      diagnostics: [{ code: ARXIC_PROMOTION_REDACTION_FAILED, severity: 'blocked' }],
    });
  });

  it('allows the test-sink email domain', async () => {
    const result = await scanBundleForSensitiveData(await textBundle('account=user@example.test'));
    expect(result).toMatchObject({ passed: true, findings: [], diagnostics: [] });
  });

  it('allows environment variable references', async () => {
    const directory = await textBundle(
      'password = process.env["ARXIC_INPUT_PERSONA_EMAIL"]\napiKey = ARXIC_INPUT_API_KEY',
    );
    expect(await scanBundleForSensitiveData(directory)).toMatchObject({ passed: true });
  });

  it('blocks bearer authorization tokens', async () => {
    const directory = await textBundle(
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.authentication-payload',
    );
    const result = await scanBundleForSensitiveData(directory);
    expect(result.passed).toBe(false);
    expect(result.findings.map(({ pattern }) => pattern)).toEqual(
      expect.arrayContaining(['authorization-header', 'bearer-token']),
    );
  });

  it('writes matching checksums for every listed file', async () => {
    const assembly = await assemblyFixture();
    const lines = assembly.checksumsSha256.trimEnd().split('\n');
    for (const line of lines) {
      const [expected, path] = line.split('  ');
      const actual = createHash('sha256')
        .update(await readFile(join(assembly.directory, path!)))
        .digest('hex');
      expect(actual, path).toBe(expected);
    }
    expect(lines.some((line) => line.endsWith('  checksums.sha256'))).toBe(false);
    expect(assembly.files.map(({ path }) => path)).toContain('checksums.sha256');
  });

  it('rejects raw traces and accepts independently inspected sanitized traces', async () => {
    const stagedDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-staged-'));
    const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-output-'));
    const rawDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-raw-'));
    const rawTrace = join(rawDirectory, 'raw.zip');
    const protectedValue = ['bundle', 'trace', 'credential'].join('-');
    await writeFile(rawTrace, await sensitiveTrace(protectedValue));
    const rawArtifact: ArtifactRef = {
      kind: 'trace',
      path: rawTrace,
      sha256: hash(await readFile(rawTrace)),
    };
    const bundle = await stagedAssemblyBundle(stagedDirectory);

    await expect(
      assembleBundle({
        bundle,
        stagedDirectory,
        outputDirectory,
        verificationArtifacts: [rawArtifact],
        provenance: provenanceFor(bundle),
      }),
    ).rejects.toThrow('lacks sanitization provenance');

    const rawBundleDirectory = join(rawDirectory, 'bundle');
    await mkdir(join(rawBundleDirectory, 'artifacts', 'traces'), { recursive: true });
    await writeFile(
      join(rawBundleDirectory, 'artifacts', 'traces', 'raw.zip'),
      await readFile(rawTrace),
    );
    expect(await scanBundleForSensitiveData(rawBundleDirectory)).toMatchObject({
      passed: false,
      findings: [expect.objectContaining({ pattern: expect.stringContaining('playwright-trace') })],
    });

    const sanitizedTrace = join(rawDirectory, 'sanitized.zip');
    const reportPath = `${sanitizedTrace}.sanitization.json`;
    const sanitized = await sanitizePlaywrightTrace({
      sourcePath: rawTrace,
      outputPath: sanitizedTrace,
      provenancePath: reportPath,
      forbiddenSubstrings: [protectedValue],
    });
    expect(sanitized.ok, JSON.stringify(sanitized)).toBe(true);
    const artifacts: ArtifactRef[] = [
      { kind: 'trace', path: sanitizedTrace, sha256: hash(await readFile(sanitizedTrace)) },
      {
        kind: 'trace-sanitization-report',
        path: reportPath,
        sha256: hash(await readFile(reportPath)),
      },
    ];
    const assembly = await assembleBundle({
      bundle,
      stagedDirectory,
      outputDirectory,
      verificationArtifacts: artifacts,
      provenance: provenanceFor(bundle),
      now: () => '2026-08-09T00:00:00.000Z',
    });

    expect(await scanBundleForSensitiveData(assembly.directory)).toMatchObject({ passed: true });
    expect(
      await readFile(join(assembly.directory, 'artifacts', 'traces', '001-trace.zip')),
    ).not.toEqual(await readFile(rawTrace));
  });

  it('rejects a raw ZIP mislabeled as a screenshot before changing bundle output', async () => {
    const stagedDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-staged-'));
    const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-output-'));
    const rawDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-raw-'));
    const marker = join(outputDirectory, 'prior-output.txt');
    const rawTrace = join(rawDirectory, 'mislabeled.png');
    await writeFile(marker, 'prior output');
    await writeFile(rawTrace, await sensitiveTrace('mislabeled-credential'));
    const bundle = await stagedAssemblyBundle(stagedDirectory);

    await expect(
      assembleBundle({
        bundle,
        stagedDirectory,
        outputDirectory,
        verificationArtifacts: [
          { kind: 'screenshot', path: rawTrace, sha256: hash(await readFile(rawTrace)) },
        ],
        provenance: provenanceFor(bundle),
      }),
    ).rejects.toThrow('ZIP content is not classified as a trace');
    await expect(readFile(marker, 'utf8')).resolves.toBe('prior output');
  });

  it('accepts a structurally complete PNG even when a text chunk contains ZIP magic', async () => {
    const stagedDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-staged-'));
    const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-output-'));
    const screenshotDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-screenshot-'));
    const screenshot = join(screenshotDirectory, 'proof.png');
    const bytes = pngWithZipSignatureChunk();
    await writeFile(screenshot, bytes);
    const bundle = await stagedAssemblyBundle(stagedDirectory);

    const assembly = await assembleBundle({
      bundle,
      stagedDirectory,
      outputDirectory,
      verificationArtifacts: [{ kind: 'screenshot', path: screenshot, sha256: hash(bytes) }],
      provenance: provenanceFor(bundle),
    });

    await expect(
      readFile(join(assembly.directory, 'artifacts', 'screenshots', '001-screenshot.png')),
    ).resolves.toEqual(bytes);
  });

  it('accepts a bounded invalid ZIP lookalike inside a valid ancillary chunk', async () => {
    const stagedDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-staged-'));
    const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-output-'));
    const screenshotDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-lookalike-'));
    const screenshot = join(screenshotDirectory, 'proof.png');
    const incompleteEocd = Buffer.alloc(22);
    Buffer.from([0x50, 0x4b, 0x05, 0x06]).copy(incompleteEocd);
    incompleteEocd.writeUInt16LE(1, 20);
    const bytes = pngWithAncillaryPayload(
      Buffer.concat([
        Buffer.from('proof\0'),
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        incompleteEocd,
      ]),
    );
    await writeFile(screenshot, bytes);
    const bundle = await stagedAssemblyBundle(stagedDirectory);

    const assembly = await assembleBundle({
      bundle,
      stagedDirectory,
      outputDirectory,
      verificationArtifacts: [{ kind: 'screenshot', path: screenshot, sha256: hash(bytes) }],
      provenance: provenanceFor(bundle),
    });

    await expect(
      readFile(join(assembly.directory, 'artifacts', 'screenshots', '001-screenshot.png')),
    ).resolves.toEqual(bytes);
  });

  it('rejects a complete raw trace ZIP carried inside valid PNG ancillary data', async () => {
    const stagedDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-staged-'));
    const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-output-'));
    const screenshotDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-embedded-zip-'));
    const screenshot = join(screenshotDirectory, 'proof.png');
    const marker = join(outputDirectory, 'prior-output.txt');
    const bytes = pngWithAncillaryPayload(
      Buffer.concat([Buffer.from('proof\0'), await sensitiveTrace('embedded-credential')]),
    );
    await writeFile(screenshot, bytes);
    await writeFile(marker, 'prior output');
    const bundle = await stagedAssemblyBundle(stagedDirectory);

    await expect(
      assembleBundle({
        bundle,
        stagedDirectory,
        outputDirectory,
        verificationArtifacts: [{ kind: 'screenshot', path: screenshot, sha256: hash(bytes) }],
        provenance: provenanceFor(bundle),
      }),
    ).rejects.toThrow('ancillary content contains a ZIP archive');
    await expect(readFile(marker, 'utf8')).resolves.toBe('prior output');
  });

  it('rejects a raw trace ZIP split across valid PNG ancillary chunks', async () => {
    const stagedDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-staged-'));
    const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-output-'));
    const screenshotDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-split-zip-'));
    const screenshot = join(screenshotDirectory, 'proof.png');
    const marker = join(outputDirectory, 'prior-output.txt');
    const rawTrace = await sensitiveTrace('split-credential');
    const split = Math.floor(rawTrace.byteLength / 2);
    const bytes = pngWithAncillaryPayloads([
      rawTrace.subarray(0, split),
      rawTrace.subarray(split),
    ]);
    await writeFile(screenshot, bytes);
    await writeFile(marker, 'prior output');
    const bundle = await stagedAssemblyBundle(stagedDirectory);

    await expect(
      assembleBundle({
        bundle,
        stagedDirectory,
        outputDirectory,
        verificationArtifacts: [{ kind: 'screenshot', path: screenshot, sha256: hash(bytes) }],
        provenance: provenanceFor(bundle),
      }),
    ).rejects.toThrow('ancillary content contains a ZIP archive');
    await expect(readFile(marker, 'utf8')).resolves.toBe('prior output');
  });

  it('bounds ZIP candidates across multiple ancillary chunks and fails closed', async () => {
    const stagedDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-staged-'));
    const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-output-'));
    const screenshotDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-zip-candidates-'));
    const screenshot = join(screenshotDirectory, 'proof.png');
    const marker = join(outputDirectory, 'prior-output.txt');
    const bytes = pngWithAncillaryPayloads(
      Array.from({ length: 65 }, (_, index) =>
        Buffer.concat([Buffer.from(`proof-${index}\0`), Buffer.from([0x50, 0x4b, 0x03, 0x04])]),
      ),
    );
    await writeFile(screenshot, bytes);
    await writeFile(marker, 'prior output');
    const bundle = await stagedAssemblyBundle(stagedDirectory);

    await expect(
      assembleBundle({
        bundle,
        stagedDirectory,
        outputDirectory,
        verificationArtifacts: [{ kind: 'screenshot', path: screenshot, sha256: hash(bytes) }],
        provenance: provenanceFor(bundle),
      }),
    ).rejects.toThrow('ancillary content contains a ZIP archive');
    await expect(readFile(marker, 'utf8')).resolves.toBe('prior output');
  });

  it('bounds the ancillary ZIP parser-attempt cross product and fails closed', async () => {
    const stagedDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-staged-'));
    const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-output-'));
    const screenshotDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-zip-work-'));
    const screenshot = join(screenshotDirectory, 'proof.png');
    const marker = join(outputDirectory, 'prior-output.txt');
    const invalidEocd = Buffer.alloc(22);
    Buffer.from([0x50, 0x4b, 0x05, 0x06]).copy(invalidEocd);
    invalidEocd.writeUInt16LE(1, 8);
    invalidEocd.writeUInt16LE(1, 10);
    const payload = Buffer.concat([
      Buffer.from('proof\0'),
      ...Array.from({ length: 8 }, () => Buffer.from([0x50, 0x4b, 0x03, 0x04])),
      ...Array.from({ length: 8 }, () => invalidEocd),
    ]);
    const bytes = pngWithAncillaryPayload(payload);
    await writeFile(screenshot, bytes);
    await writeFile(marker, 'prior output');
    const bundle = await stagedAssemblyBundle(stagedDirectory);

    await expect(
      assembleBundle({
        bundle,
        stagedDirectory,
        outputDirectory,
        verificationArtifacts: [{ kind: 'screenshot', path: screenshot, sha256: hash(bytes) }],
        provenance: provenanceFor(bundle),
      }),
    ).rejects.toThrow('ancillary content contains a ZIP archive');
    await expect(readFile(marker, 'utf8')).resolves.toBe('prior output');
  });

  it('bounds the total number of PNG ancillary chunks and fails closed', async () => {
    const stagedDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-staged-'));
    const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-output-'));
    const screenshotDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-png-chunks-'));
    const screenshot = join(screenshotDirectory, 'proof.png');
    const marker = join(outputDirectory, 'prior-output.txt');
    const bytes = pngWithAncillaryPayloads(
      Array.from({ length: 257 }, (_, index) => Buffer.from(`proof-${index}\0`)),
    );
    await writeFile(screenshot, bytes);
    await writeFile(marker, 'prior output');
    const bundle = await stagedAssemblyBundle(stagedDirectory);

    await expect(
      assembleBundle({
        bundle,
        stagedDirectory,
        outputDirectory,
        verificationArtifacts: [{ kind: 'screenshot', path: screenshot, sha256: hash(bytes) }],
        provenance: provenanceFor(bundle),
      }),
    ).rejects.toThrow('Screenshot artifact is not a strict PNG');
    await expect(readFile(marker, 'utf8')).resolves.toBe('prior output');
  });

  it('rejects a sensitive source artifact filename before changing bundle output', async () => {
    const stagedDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-staged-'));
    const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-output-'));
    const screenshotDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-sensitive-name-'));
    const screenshot = join(screenshotDirectory, 'sessionOpaqueFilenameCanary.png');
    const marker = join(outputDirectory, 'prior-output.txt');
    const bytes = validPng();
    await writeFile(screenshot, bytes);
    await writeFile(marker, 'prior output');
    const bundle = await stagedAssemblyBundle(stagedDirectory);

    await expect(
      assembleBundle({
        bundle,
        stagedDirectory,
        outputDirectory,
        verificationArtifacts: [{ kind: 'screenshot', path: screenshot, sha256: hash(bytes) }],
        provenance: provenanceFor(bundle),
      }),
    ).rejects.toThrow('filename contains sensitive context');
    await expect(readFile(marker, 'utf8')).resolves.toBe('prior output');
  });

  it('rejects a valid PNG prefix with a trailing raw-trace ZIP payload', async () => {
    const stagedDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-staged-'));
    const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-output-'));
    const screenshotDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-polyglot-'));
    const screenshot = join(screenshotDirectory, 'proof.png');
    const marker = join(outputDirectory, 'prior-output.txt');
    const bytes = Buffer.concat([validPng(), await sensitiveTrace('polyglot-credential')]);
    await writeFile(screenshot, bytes);
    await writeFile(marker, 'prior output');
    const bundle = await stagedAssemblyBundle(stagedDirectory);

    await expect(
      assembleBundle({
        bundle,
        stagedDirectory,
        outputDirectory,
        verificationArtifacts: [{ kind: 'screenshot', path: screenshot, sha256: hash(bytes) }],
        provenance: provenanceFor(bundle),
      }),
    ).rejects.toThrow('Screenshot artifact is not a strict PNG');
    await expect(readFile(marker, 'utf8')).resolves.toBe('prior output');
  });

  it('refuses to erase an output path containing the staged directory', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-parent-'));
    const stagedDirectory = join(outputDirectory, 'staged');
    await mkdir(stagedDirectory);
    await expect(
      assembleBundle({
        bundle: await stagedBundle(),
        stagedDirectory,
        outputDirectory,
        provenance: {
          repository: 'https://github.com/anthonykewl20/arxic',
          commit: '0123456789abcdef0123456789abcdef01234567',
          appBuildDigest: 'a'.repeat(64),
        },
      }),
    ).rejects.toThrow('must not contain the staged directory');
    await expect(stat(stagedDirectory)).resolves.toBeDefined();
  });

  it('creates the complete ADR section 14 layout', async () => {
    const assembly = await assemblyFixture();
    for (const path of [
      'manifest.json',
      'workflow.json',
      'plan.md',
      'tests/workflow.spec.ts',
      'fixtures/workflow.fixture.ts',
      'playwright.config.ts',
      'evidence/index.json',
      'artifacts/screenshots',
      'artifacts/traces',
      'artifacts/reports',
      'provenance.json',
      'NOTICE',
      'checksums.sha256',
    ]) {
      await expect(stat(join(assembly.directory, path)), path).resolves.toBeDefined();
    }
  });

  it('loop-closes the redaction diagnostic through the frozen validator', () => {
    expect(
      validateDiagnostic({
        code: ARXIC_PROMOTION_REDACTION_FAILED,
        severity: 'blocked',
        subject: 'artifact.txt',
        message: 'Sensitive content was blocked',
      }),
    ).toMatchObject({ ok: true });
  });
});

async function textBundle(content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-redaction-'));
  await writeFile(join(directory, 'artifact.txt'), content, 'utf8');
  await writeFile(join(directory, 'ignored.png'), content);
  return directory;
}

async function assemblyFixture() {
  const stagedDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-staged-'));
  const outputDirectory = await mkdtemp(join(tmpdir(), 'arxic-assembly-output-'));
  const files = [
    [
      'tests/workflow.spec.ts',
      "import { test } from '@playwright/test';\ntest('workflow', async () => {});\n",
    ],
    ['fixtures/workflow.fixture.ts', 'export const fixture = true;\n'],
    ['playwright.config.ts', 'export default { workers: 1 };\n'],
  ] as const;
  const artifacts: ArtifactRef[] = [];
  for (const [path, content] of files) {
    await mkdir(join(stagedDirectory, path, '..'), { recursive: true });
    await writeFile(join(stagedDirectory, path), content, 'utf8');
    artifacts.push({ kind: path, path, sha256: hash(content) });
  }
  const base = await stagedBundle();
  const bundle: StagedBundle = { ...base, artifacts };
  return assembleBundle({
    bundle,
    stagedDirectory,
    outputDirectory,
    provenance: {
      repository: bundle.manifest.repository,
      commit: bundle.manifest.commit,
      appBuildDigest: bundle.manifest.appBuildDigest,
    },
    now: () => '2026-08-06T12:00:00.000Z',
  });
}

async function stagedAssemblyBundle(stagedDirectory: string): Promise<StagedBundle> {
  const files = [
    [
      'tests/workflow.spec.ts',
      "import { test } from '@playwright/test';\ntest('workflow', async () => {});\n",
    ],
    ['fixtures/workflow.fixture.ts', 'export const fixture = true;\n'],
    ['playwright.config.ts', 'export default { workers: 1 };\n'],
  ] as const;
  const artifacts: ArtifactRef[] = [];
  for (const [path, content] of files) {
    await mkdir(join(stagedDirectory, path, '..'), { recursive: true });
    await writeFile(join(stagedDirectory, path), content, 'utf8');
    artifacts.push({ kind: path, path, sha256: hash(content) });
  }
  return { ...(await stagedBundle()), artifacts };
}

function provenanceFor(bundle: StagedBundle) {
  return {
    repository: bundle.manifest.repository,
    commit: bundle.manifest.commit,
    appBuildDigest: bundle.manifest.appBuildDigest,
  };
}

async function sensitiveTrace(value: string): Promise<Buffer> {
  const archive = new ZipFile();
  archive.addBuffer(
    Buffer.from(
      `${JSON.stringify({ type: 'context-options', version: 8, browserName: 'chromium' })}\n${JSON.stringify(
        {
          type: 'before',
          callId: 'call@1',
          startTime: 1,
          class: 'Frame',
          method: 'fill',
          params: { selector: 'internal:label=Password', value },
        },
      )}\n${JSON.stringify({ type: 'after', callId: 'call@1', endTime: 2 })}\n`,
    ),
    'trace.trace',
  );
  archive.end();
  const chunks: Buffer[] = [];
  for await (const chunk of archive.outputStream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function hash(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function validPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
}

function pngWithZipSignatureChunk(): Buffer {
  const payload = Buffer.from([0x70, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0x50, 0x4b, 0x03, 0x04]);
  return pngWithAncillaryPayload(payload);
}

function pngWithAncillaryPayload(payload: Buffer): Buffer {
  return pngWithAncillaryPayloads([payload]);
}

function pngWithAncillaryPayloads(payloads: readonly Buffer[]): Buffer {
  const png = validPng();
  const type = Buffer.from('tEXt');
  const chunks = payloads.map((payload) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(payload.byteLength);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(testCrc32(Buffer.concat([type, payload])));
    return Buffer.concat([length, type, payload, crc]);
  });
  return Buffer.concat([
    png.subarray(0, png.byteLength - 12),
    ...chunks,
    png.subarray(png.byteLength - 12),
  ]);
}

function testCrc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
