import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { StagedBundle } from '@arxic/contracts';
import {
  DEFAULT_TRACE_ARCHIVE_LIMITS,
  sanitizePlaywrightTrace,
} from '@arxic/playwright-trace-sanitizer';
import { describe, expect, it } from 'vitest';
import { ZipFile } from 'yazl';
import {
  ARXIC_PROMOTION_ATOMIC_REPLACE_FAILED,
  ARXIC_PROMOTION_GATE_FAILED,
  ARXIC_PROMOTION_HASH_MISMATCH,
  ARXIC_PROMOTION_LOCK_CONTENTION,
  ARXIC_PROMOTION_REDACTION_FAILED,
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
  it('promotes an ordinary source artifact with isolated ZIP-magic lookalikes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-promotion-source-name-'));
    const sourcePath = join(directory, 'session.ts');
    const sourceBytes = Buffer.concat([
      Buffer.from('export const session = true;\n'),
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from(' truncated local-header lookalike'),
    ]);
    await writeFile(sourcePath, sourceBytes);
    const bundle = await stagedBundle('source-name-control');
    bundle.artifacts = [{ kind: 'source', path: sourcePath, sha256: digest(sourceBytes) }];
    bundle.manifest.fileHashes = [{ path: sourcePath, sha256: digest(sourceBytes) }];
    const publicPath = join(directory, 'public.json');

    const result = await new BundlePromoterAdapter({ publicPath }).promoteWithDiagnostics(bundle, [
      { gate: 'execution', passed: true },
    ]);

    expect(result.receipt).toBeDefined();
    expect(result.diagnostics).toEqual([]);
  });

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

  it('independently validates sanitized trace bytes before promotion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-promotion-trace-'));
    const rawPath = join(directory, 'raw.zip');
    const tracePath = join(directory, 'sanitized.zip');
    const reportPath = `${tracePath}.sanitization.json`;
    await writeFile(rawPath, await sensitiveTrace());
    const sanitized = await sanitizePlaywrightTrace({
      sourcePath: rawPath,
      outputPath: tracePath,
      provenancePath: reportPath,
    });
    expect(sanitized.ok, JSON.stringify(sanitized)).toBe(true);

    const bundle = await stagedBundle('sanitized-trace');
    bundle.artifacts.push(
      { kind: 'trace', path: tracePath, sha256: digest(await readFile(tracePath)) },
      {
        kind: 'trace-sanitization-report',
        path: reportPath,
        sha256: digest(await readFile(reportPath)),
      },
    );
    await expect(
      new BundlePromoterAdapter({ publicPath: join(directory, 'accepted.json') }).promote(bundle, [
        { gate: 'execution', passed: true },
      ]),
    ).resolves.toBeDefined();

    const changedBytes = Buffer.concat([await readFile(tracePath), Buffer.from([0])]);
    await writeFile(tracePath, changedBytes);
    bundle.artifacts.find(({ kind }) => kind === 'trace')!.sha256 = digest(changedBytes);
    const publicPath = join(directory, 'blocked.json');
    const result = await new BundlePromoterAdapter({ publicPath }).promoteWithDiagnostics(bundle, [
      { gate: 'execution', passed: true },
    ]);
    expect(result).toMatchObject({
      diagnostics: [{ code: ARXIC_PROMOTION_REDACTION_FAILED, severity: 'blocked' }],
    });
    await expect(readFile(publicPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['trace JSONL', 'provenance JSON', 'ZIP container'] as const)(
    'blocks a non-canonical %s encoding before public write',
    async (channel) => {
      const directory = await mkdtemp(join(tmpdir(), 'arxic-promotion-canonical-trace-'));
      const rawPath = join(directory, 'raw.zip');
      const tracePath = join(directory, 'sanitized.zip');
      const reportPath = `${tracePath}.sanitization.json`;
      await writeFile(rawPath, await sensitiveTrace());
      expect(
        (
          await sanitizePlaywrightTrace({
            sourcePath: rawPath,
            outputPath: tracePath,
            provenancePath: reportPath,
          })
        ).ok,
      ).toBe(true);

      if (channel === 'trace JSONL') {
        const entries = await readTestArchive(await readFile(tracePath));
        const [name, bytes] = entries.entries().next().value!;
        entries.set(name, Buffer.concat([Buffer.from(' '), bytes]));
        const trace = await writeCanonicalTestArchive(entries);
        await writeFile(tracePath, trace);
        await updateTraceReport(reportPath, trace, entries);
      } else if (channel === 'provenance JSON') {
        const report = JSON.parse(await readFile(reportPath, 'utf8')) as unknown;
        await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      } else {
        const canonical = await readFile(tracePath);
        const trace = withZipComment(canonical, Buffer.from('noncanonical-container'));
        await writeFile(tracePath, trace);
        await updateTraceReport(reportPath, trace, await readTestArchive(trace));
      }

      const trace = await readFile(tracePath);
      const report = await readFile(reportPath);
      const bundle = await stagedBundle(`noncanonical-${channel.replaceAll(' ', '-')}`);
      bundle.artifacts.push(
        { kind: 'trace', path: tracePath, sha256: digest(trace) },
        { kind: 'trace-sanitization-report', path: reportPath, sha256: digest(report) },
      );
      const publicPath = join(directory, 'public.json');
      await writeFile(publicPath, 'prior public bytes');

      const result = await new BundlePromoterAdapter({ publicPath }).promoteWithDiagnostics(
        bundle,
        [{ gate: 'execution', passed: true }],
      );

      expect(result).toMatchObject({
        diagnostics: [{ code: ARXIC_PROMOTION_REDACTION_FAILED, severity: 'blocked' }],
      });
      await expect(readFile(publicPath, 'utf8')).resolves.toBe('prior public bytes');
    },
  );

  it('blocks an oversized trace before freeze or public write', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-promotion-oversized-trace-'));
    const tracePath = join(directory, 'oversized.zip');
    const reportPath = `${tracePath}.sanitization.json`;
    await writeFile(tracePath, '');
    await truncate(tracePath, DEFAULT_TRACE_ARCHIVE_LIMITS.maxArchiveBytes + 1);
    await writeFile(reportPath, '{}');
    const bundle = await stagedBundle('oversized-trace');
    bundle.artifacts.push(
      { kind: 'trace', path: tracePath, sha256: '0'.repeat(64) },
      { kind: 'trace-sanitization-report', path: reportPath, sha256: digest('{}') },
    );
    const publicPath = join(directory, 'public.json');

    const result = await new BundlePromoterAdapter({ publicPath }).promoteWithDiagnostics(bundle, [
      { gate: 'execution', passed: true },
    ]);

    expect(result).toMatchObject({
      diagnostics: [{ code: ARXIC_PROMOTION_REDACTION_FAILED, severity: 'blocked' }],
    });
    await expect(readFile(publicPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('blocks an oversized provenance report before freeze or public write', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-promotion-oversized-report-'));
    const rawPath = join(directory, 'raw.zip');
    const tracePath = join(directory, 'sanitized.zip');
    const reportPath = `${tracePath}.sanitization.json`;
    await writeFile(rawPath, await sensitiveTrace());
    expect(
      (
        await sanitizePlaywrightTrace({
          sourcePath: rawPath,
          outputPath: tracePath,
          provenancePath: reportPath,
        })
      ).ok,
    ).toBe(true);
    await truncate(reportPath, 1024 * 1024 + 1);
    const bundle = await stagedBundle('oversized-report');
    bundle.artifacts.push(
      { kind: 'trace', path: tracePath, sha256: digest(await readFile(tracePath)) },
      { kind: 'trace-sanitization-report', path: reportPath, sha256: '0'.repeat(64) },
    );
    const publicPath = join(directory, 'public.json');

    const result = await new BundlePromoterAdapter({ publicPath }).promoteWithDiagnostics(bundle, [
      { gate: 'execution', passed: true },
    ]);

    expect(result).toMatchObject({
      diagnostics: [{ code: ARXIC_PROMOTION_REDACTION_FAILED, severity: 'blocked' }],
    });
    await expect(readFile(publicPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a raw ZIP mislabeled as another artifact kind', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-promotion-mislabeled-trace-'));
    const rawPath = join(directory, 'raw.png');
    await writeFile(rawPath, await sensitiveTrace());
    const bundle = await stagedBundle('mislabeled-trace');
    bundle.artifacts.push({
      kind: 'screenshot',
      path: rawPath,
      sha256: digest(await readFile(rawPath)),
    });
    const publicPath = join(directory, 'public.json');
    await writeFile(publicPath, 'prior public bytes');

    const result = await new BundlePromoterAdapter({ publicPath }).promoteWithDiagnostics(bundle, [
      { gate: 'execution', passed: true },
    ]);

    expect(result).toMatchObject({
      diagnostics: [{ code: ARXIC_PROMOTION_REDACTION_FAILED, severity: 'blocked' }],
    });
    await expect(readFile(publicPath, 'utf8')).resolves.toBe('prior public bytes');
  });

  it('blocks a complete trace ZIP embedded in PNG ancillary data before public write', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-promotion-embedded-trace-'));
    const screenshotPath = join(directory, 'proof.png');
    const bytes = pngWithAncillaryPayload(
      Buffer.concat([Buffer.from('proof\0'), await sensitiveTrace()]),
    );
    await writeFile(screenshotPath, bytes);
    const bundle = await stagedBundle('embedded-trace');
    bundle.artifacts.push({
      kind: 'screenshot',
      path: screenshotPath,
      sha256: digest(bytes),
    });
    const publicPath = join(directory, 'public.json');
    await writeFile(publicPath, 'prior public bytes');

    const result = await new BundlePromoterAdapter({ publicPath }).promoteWithDiagnostics(bundle, [
      { gate: 'execution', passed: true },
    ]);

    expect(result).toMatchObject({
      diagnostics: [{ code: ARXIC_PROMOTION_REDACTION_FAILED, severity: 'blocked' }],
    });
    await expect(readFile(publicPath, 'utf8')).resolves.toBe('prior public bytes');
  });

  it('blocks a trace ZIP split across PNG ancillary chunks before public write', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arxic-promotion-split-trace-'));
    const screenshotPath = join(directory, 'proof.png');
    const rawTrace = await sensitiveTrace();
    const split = Math.floor(rawTrace.byteLength / 2);
    const bytes = pngWithAncillaryPayloads([
      rawTrace.subarray(0, split),
      rawTrace.subarray(split),
    ]);
    await writeFile(screenshotPath, bytes);
    const bundle = await stagedBundle('split-trace');
    bundle.artifacts.push({
      kind: 'screenshot',
      path: screenshotPath,
      sha256: digest(bytes),
    });
    const publicPath = join(directory, 'public.json');
    await writeFile(publicPath, 'prior public bytes');

    const result = await new BundlePromoterAdapter({ publicPath }).promoteWithDiagnostics(bundle, [
      { gate: 'execution', passed: true },
    ]);

    expect(result).toMatchObject({
      diagnostics: [{ code: ARXIC_PROMOTION_REDACTION_FAILED, severity: 'blocked' }],
    });
    await expect(readFile(publicPath, 'utf8')).resolves.toBe('prior public bytes');
  });
});

async function sensitiveTrace(): Promise<Buffer> {
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
          params: { selector: 'internal:label=Password', value: 'credential-canary' },
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

async function readTestArchive(bytes: Buffer): Promise<Map<string, Buffer>> {
  expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  expect(bytes.readUInt16LE(8)).toBe(0);
  const size = bytes.readUInt32LE(18);
  const nameLength = bytes.readUInt16LE(26);
  const extraLength = bytes.readUInt16LE(28);
  const nameStart = 30;
  const dataStart = nameStart + nameLength + extraLength;
  return new Map([
    [
      bytes.subarray(nameStart, dataStart - extraLength).toString('utf8'),
      bytes.subarray(dataStart, dataStart + size),
    ],
  ]);
}

async function writeCanonicalTestArchive(entries: ReadonlyMap<string, Buffer>): Promise<Buffer> {
  const archive = new ZipFile();
  for (const [name, bytes] of [...entries].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    archive.addBuffer(bytes, name, {
      mtime: new Date('1980-01-01T00:00:00.000Z'),
      mode: 0o100644,
      compress: false,
      forceDosTimestamp: true,
    });
  }
  archive.end({ forceZip64Format: false, comment: '' });
  const chunks: Buffer[] = [];
  for await (const chunk of archive.outputStream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function updateTraceReport(
  reportPath: string,
  trace: Buffer,
  entries: ReadonlyMap<string, Buffer>,
): Promise<void> {
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
    output: { sha256: string; size: number };
    residualScan: { passed: true; scannedBytes: number; scannedEntries: number };
  };
  report.output.sha256 = digest(trace);
  report.output.size = trace.byteLength;
  report.residualScan.scannedBytes = [...entries.values()].reduce(
    (total, bytes) => total + bytes.byteLength,
    0,
  );
  report.residualScan.scannedEntries = entries.size;
  await writeFile(reportPath, `${JSON.stringify(report)}\n`, 'utf8');
}

function withZipComment(bytes: Buffer, comment: Buffer): Buffer {
  const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocd = bytes.lastIndexOf(signature);
  expect(eocd).toBeGreaterThanOrEqual(0);
  const result = Buffer.concat([Buffer.from(bytes), comment]);
  result.writeUInt16LE(comment.byteLength, eocd + 20);
  return result;
}

function digest(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function pngWithAncillaryPayload(payload: Buffer): Buffer {
  return pngWithAncillaryPayloads([payload]);
}

function pngWithAncillaryPayloads(payloads: readonly Buffer[]): Buffer {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const type = Buffer.from('raWx');
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
