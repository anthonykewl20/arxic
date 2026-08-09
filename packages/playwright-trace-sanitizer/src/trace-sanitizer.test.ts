import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { ZipFile } from 'yazl';
import {
  inspectPlaywrightTrace,
  sanitizeCapturedPlaywrightTrace,
  sanitizePlaywrightTrace,
  type TraceSanitizationFailureCode,
} from './trace-sanitizer';
import { validateScreenshotCheckpointFilenames } from './trace-carrier-classifier';
import { readArchive, writeDeterministicArchive } from './zip';

const temporaryDirectories: string[] = [];
const protectedEmail = ['trace-person', 'example.test'].join('@');
const protectedPassword = ['trace', 'password', 'value'].join('-');
const protectedToken = ['trace', 'token', 'value'].join('-');
const forbidden = [protectedEmail, protectedPassword, protectedToken];
const requestBodyRef = `${'1'.repeat(40)}.txt`;
const responseBodyRef = `${'2'.repeat(40)}.html`;
const screencastRef = `page@${'a'.repeat(32)}-123.jpeg`;
const opaqueHashCanary = '3'.repeat(40);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('screenshot checkpoint source binding', () => {
  test.each([
    {
      label: 'logout with repeated home screenshots',
      fileNames: ['step-1-login-page-home.png', 'step-2-home-home.png'],
      checkpoints: ['home'],
    },
    {
      label: 'password change with repeated destination screenshots',
      fileNames: [
        'step-1-login-page-home.png',
        'step-2-home-change-password-page.png',
        'step-3-change-password-page-change-password-page.png',
      ],
      checkpoints: ['home', 'change-password-page'],
    },
    {
      label: 'source order permutation',
      fileNames: ['step-2-home-home.png', 'step-1-login-page-home.png'],
      checkpoints: ['home'],
    },
    {
      label: 'overlapping checkpoint suffixes',
      fileNames: ['step-1-start-login-home.png', 'step-2-login-home-home.png'],
      checkpoints: ['home', 'login-home'],
    },
  ])('accepts an injective mapping for $label', ({ fileNames, checkpoints }) => {
    expect(validateScreenshotCheckpointFilenames(fileNames, checkpoints)).toEqual({ ok: true });
  });

  test.each([
    {
      label: 'duplicate checkpoint declaration',
      fileNames: ['step-1-login-page-home.png', 'step-2-home-home.png'],
      checkpoints: ['home', 'home'],
      expected: { ok: false, code: 'duplicate-checkpoint' },
    },
    {
      label: 'safe nonmatching source',
      fileNames: ['step-1-login-page-profile.png'],
      checkpoints: ['home'],
      expected: { ok: false, code: 'missing-source', missingCheckpoint: 'home' },
    },
    {
      label: 'overlapping checkpoints with no unused source',
      fileNames: ['step-1-start-login-home.png'],
      checkpoints: ['home', 'login-home'],
      expected: { ok: false, code: 'missing-source', missingCheckpoint: 'home' },
    },
  ])('rejects $label', ({ fileNames, checkpoints, expected }) => {
    expect(validateScreenshotCheckpointFilenames(fileNames, checkpoints)).toEqual(expected);
  });
});

describe('Playwright trace sanitization service', () => {
  test('sanitizes every trace prefix into an allowlisted action timeline', async () => {
    const fixture = await traceFixture();

    const result = await sanitizePlaywrightTrace({
      sourcePath: fixture.raw,
      outputPath: fixture.sanitized,
      provenancePath: fixture.provenance,
      forbiddenSubstrings: forbidden,
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.provenance.logicalMembers).toEqual([
      'trace-001.trace',
      'trace-002.trace',
      'trace-003.trace',
    ]);
    expect(result.provenance.source.sha256).toBe(
      createHash('sha256')
        .update(await readFile(fixture.raw))
        .digest('hex'),
    );
    expect(result.provenance.output.sha256).toBe(
      createHash('sha256')
        .update(await readFile(fixture.sanitized))
        .digest('hex'),
    );
    expect(result.provenance.residualScan).toMatchObject({ passed: true });

    const entries = await readArchive(fixture.sanitized);
    expect([...entries.keys()].filter((name) => name.endsWith('.trace')).sort()).toEqual([
      'trace-001.trace',
      'trace-002.trace',
      'trace-003.trace',
    ]);
    expect([...entries.keys()]).not.toEqual(
      expect.arrayContaining([
        `resources/${requestBodyRef}`,
        'resources/src@private-source.txt',
        'resources/unreferenced.txt',
      ]),
    );
    expect([...entries.keys()].some((name) => name.startsWith('resources/'))).toBe(false);

    const allBytes = Buffer.concat([...entries.values()]).toString('utf8');
    for (const canary of forbidden) expect(allBytes).not.toContain(canary);
    expect(allBytes).not.toContain('/home/private/spec.ts');
    expect(allBytes).not.toContain('Cookie');
    expect(allBytes).not.toContain('Set-Cookie');
    expect(allBytes).not.toContain('Authorization');
    expect(allBytes).not.toContain('"postData"');
    const actionLines = entries.get('trace-002.trace')!.toString('utf8').trim().split('\n');
    const action = JSON.parse(actionLines[1]!) as { params: Record<string, unknown> };
    expect(action.params).toEqual({});
    expect(action).not.toHaveProperty('unknown');
    expect(entries.has(`resources/${screencastRef}`)).toBe(false);
    expect(allBytes).not.toContain('screencast-frame');

    await expect(
      inspectPlaywrightTrace({
        tracePath: fixture.sanitized,
        provenancePath: fixture.provenance,
        forbiddenSubstrings: forbidden,
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  test('produces deterministic trace and provenance bytes for identical logical input', async () => {
    const fixture = await traceFixture();
    const otherTrace = join(fixture.directory, 'other.zip');
    const otherProvenance = `${otherTrace}.sanitization.json`;

    const first = await sanitizePlaywrightTrace({
      sourcePath: fixture.raw,
      outputPath: fixture.sanitized,
      provenancePath: fixture.provenance,
      forbiddenSubstrings: forbidden,
    });
    const second = await sanitizePlaywrightTrace({
      sourcePath: fixture.raw,
      outputPath: otherTrace,
      provenancePath: otherProvenance,
      forbiddenSubstrings: forbidden,
    });

    expect(first.ok, JSON.stringify(first)).toBe(true);
    expect(second.ok, JSON.stringify(second)).toBe(true);
    expect(await readFile(fixture.sanitized)).toEqual(await readFile(otherTrace));
    expect(await readFile(fixture.provenance)).toEqual(await readFile(otherProvenance));
    expect((await readFile(fixture.sanitized)).readUInt16LE(8)).toBe(0);
  });

  test('produces identical canonical archive bytes across timezones', async () => {
    const entries = new Map([['trace.trace', Buffer.from('{"type":"context-options"}\n')]]);
    const originalTimezone = process.env.TZ;
    try {
      const localBytes = await writeDeterministicArchive(entries);
      process.env.TZ = 'UTC';
      const utcBytes = await writeDeterministicArchive(entries);
      expect(utcBytes).toEqual(localBytes);
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  test('strips ZIP container metadata from raw input and emits one canonical stored archive', async () => {
    const fixture = await emptyFixture();
    const raw = withArchiveComment(await validArchive(), Buffer.from('source-only-metadata'));
    await writeFile(fixture.raw, raw);

    await expect(
      sanitizePlaywrightTrace({
        sourcePath: fixture.raw,
        outputPath: fixture.sanitized,
        provenancePath: fixture.provenance,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(await readFile(fixture.sanitized)).not.toContain(Buffer.from('source-only-metadata'));
    await expect(
      inspectPlaywrightTrace({
        tracePath: fixture.sanitized,
        provenancePath: fixture.provenance,
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  test('removes the raw capture after successful sanitization', async () => {
    const fixture = await emptyFixture();
    await writeFile(fixture.raw, await validArchive());

    await expect(
      sanitizeCapturedPlaywrightTrace({
        sourcePath: fixture.raw,
        outputPath: fixture.sanitized,
        provenancePath: fixture.provenance,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(readFile(fixture.raw)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      inspectPlaywrightTrace({
        tracePath: fixture.sanitized,
        provenancePath: fixture.provenance,
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  test('blocks and removes eligible output when a sanitized raw source can only be truncated', async () => {
    const fixture = await emptyFixture();
    const lockedDirectory = join(fixture.directory, 'locked-source');
    const raw = join(lockedDirectory, 'trace.zip');
    await mkdir(lockedDirectory);
    await writeFile(raw, await validArchive());
    await chmod(lockedDirectory, 0o500);
    try {
      const result = await sanitizeCapturedPlaywrightTrace({
        sourcePath: raw,
        outputPath: fixture.sanitized,
        provenancePath: fixture.provenance,
      });
      expect(result).toMatchObject({
        ok: false,
        code: 'TRACE_SOURCE_CLEANUP_FAILED',
        cleanupFailure: { sourceDisposition: 'truncated', eligibleOutputsRemoved: true },
      });
      await expect(readFile(raw)).resolves.toHaveLength(0);
      await expect(readFile(fixture.sanitized)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(fixture.provenance)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await chmod(lockedDirectory, 0o700);
    }
  });

  test('preserves the primary sanitizer failure when raw cleanup also fails', async () => {
    const fixture = await emptyFixture();
    const lockedDirectory = join(fixture.directory, 'locked-source');
    const raw = join(lockedDirectory, 'trace.zip');
    await mkdir(lockedDirectory);
    await writeFile(raw, 'malformed trace archive');
    await chmod(raw, 0o400);
    await chmod(lockedDirectory, 0o500);
    try {
      const result = await sanitizeCapturedPlaywrightTrace({
        sourcePath: raw,
        outputPath: fixture.sanitized,
        provenancePath: fixture.provenance,
      });
      expect(result).toMatchObject({
        ok: false,
        code: 'TRACE_ZIP_INVALID',
        cleanupFailure: { sourceDisposition: 'failed', eligibleOutputsRemoved: true },
      });
      await expect(readFile(raw)).resolves.not.toHaveLength(0);
      await expect(readFile(fixture.sanitized)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(fixture.provenance)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await chmod(lockedDirectory, 0o700);
      await chmod(raw, 0o600);
    }
  });

  test.each([
    ['malformed ZIP', async () => Buffer.from('not-a-zip'), 'TRACE_ZIP_INVALID'],
    [
      'truncated ZIP',
      async () => (await validArchive()).subarray(0, (await validArchive()).length - 12),
      'TRACE_ZIP_INVALID',
    ],
    [
      'unsafe traversal member',
      async () => replaceAscii(await validArchive('evil.trace'), 'evil.trace', '../x.trace'),
      'TRACE_ZIP_UNSAFE_PATH',
    ],
    [
      'normalized duplicate member',
      async () => replaceAscii(await validArchive('a.trace', 'b.trace'), 'b.trace', 'a.trace'),
      'TRACE_ZIP_DUPLICATE_ENTRY',
    ],
  ] satisfies ReadonlyArray<[string, () => Promise<Buffer>, TraceSanitizationFailureCode]>)(
    'fails closed for %s',
    async (_name, archive, code) => {
      const fixture = await emptyFixture();
      await writeFile(fixture.raw, await archive());

      const result = await sanitizePlaywrightTrace({
        sourcePath: fixture.raw,
        outputPath: fixture.sanitized,
        provenancePath: fixture.provenance,
      });

      expect(result).toMatchObject({ ok: false, code });
    },
  );

  test('fails closed when archive limits are exceeded', async () => {
    const fixture = await emptyFixture();
    await writeFile(fixture.raw, await validArchive());

    const result = await sanitizePlaywrightTrace({
      sourcePath: fixture.raw,
      outputPath: fixture.sanitized,
      provenancePath: fixture.provenance,
      limits: { maxEntryBytes: 8 },
    });

    expect(result).toMatchObject({ ok: false, code: 'TRACE_ZIP_LIMIT_EXCEEDED' });
  });

  test('bounds a file-backed archive before allocating or parsing it', async () => {
    const fixture = await emptyFixture();
    const archive = await validArchive();
    await writeFile(fixture.raw, archive);

    await expect(
      sanitizePlaywrightTrace({
        sourcePath: fixture.raw,
        outputPath: fixture.sanitized,
        provenancePath: fixture.provenance,
        limits: { maxArchiveBytes: archive.byteLength - 1 },
      }),
    ).resolves.toMatchObject({ ok: false, code: 'TRACE_ZIP_LIMIT_EXCEEDED' });
  });

  test.each([
    {
      name: 'entry count',
      archive: () => validArchive('first.trace', 'second.trace'),
      limits: { maxEntries: 1 },
    },
    {
      name: 'total expanded bytes',
      archive: () => validArchive(),
      limits: { maxTotalBytes: 8 },
    },
    {
      name: 'compression ratio',
      archive: () =>
        zipBytes({
          'trace.trace': `${JSON.stringify({
            type: 'context-options',
            version: 8,
            title: 'x'.repeat(8 * 1024),
          })}\n`,
        }),
      limits: { maxCompressionRatio: 2 },
    },
  ])('rejects archive bombs by $name', async ({ archive, limits }) => {
    const fixture = await emptyFixture();
    await writeFile(fixture.raw, await archive());

    await expect(
      sanitizePlaywrightTrace({
        sourcePath: fixture.raw,
        outputPath: fixture.sanitized,
        provenancePath: fixture.provenance,
        limits,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'TRACE_ZIP_LIMIT_EXCEEDED' });
  });

  test.each([
    {
      name: 'oversized JSONL line',
      event: { type: 'log', message: 'x'.repeat(1024 * 1024) },
    },
    {
      name: 'excessive JSON nesting',
      event: {
        type: 'log',
        nested: Array.from({ length: 70 }).reduce<unknown>((value) => [value], 'leaf'),
      },
    },
    {
      name: 'excessive JSON node fanout',
      event: { type: 'log', values: Array.from({ length: 200_001 }, () => 0) },
    },
  ])('rejects $name before recursive projection work', async ({ event }) => {
    const fixture = await emptyFixture();
    await writeFile(
      fixture.raw,
      await zipBytes({ 'trace.trace': `${validTimeline()}${JSON.stringify(event)}\n` }),
    );

    await expect(
      sanitizePlaywrightTrace({
        sourcePath: fixture.raw,
        outputPath: fixture.sanitized,
        provenancePath: fixture.provenance,
        limits: { maxCompressionRatio: 1_000_000 },
      }),
    ).resolves.toMatchObject({ ok: false, code: 'TRACE_FORMAT_INVALID' });
  });

  test('rejects a 32 MiB newline flood during bounded single-pass scanning', async () => {
    const fixture = await emptyFixture();
    const timeline = validTimeline();
    const flood = '\n'.repeat(32 * 1024 * 1024 - Buffer.byteLength(timeline));
    await writeFile(fixture.raw, await zipBytes({ 'trace.trace': `${timeline}${flood}` }));

    await expect(
      sanitizePlaywrightTrace({
        sourcePath: fixture.raw,
        outputPath: fixture.sanitized,
        provenancePath: fixture.provenance,
        limits: { maxCompressionRatio: 1_000_000 },
      }),
    ).resolves.toMatchObject({ ok: false, code: 'TRACE_FORMAT_INVALID' });
  });

  test('rejects a timeline that exceeds the retained action budget', async () => {
    const fixture = await emptyFixture();
    const events = [
      JSON.stringify({ type: 'context-options', version: 8, browserName: 'chromium' }),
    ];
    for (let index = 0; index <= 10_000; index += 1) {
      events.push(
        JSON.stringify({
          type: 'action',
          callId: `call@${index}`,
          startTime: index * 2,
          endTime: index * 2 + 1,
          class: 'Frame',
          method: 'click',
          params: {},
        }),
      );
    }
    await writeFile(fixture.raw, await zipBytes({ 'trace.trace': `${events.join('\n')}\n` }));

    await expect(
      sanitizePlaywrightTrace({
        sourcePath: fixture.raw,
        outputPath: fixture.sanitized,
        provenancePath: fixture.provenance,
        limits: { maxCompressionRatio: 1_000_000 },
      }),
    ).resolves.toMatchObject({ ok: false, code: 'TRACE_FORMAT_INVALID' });
  });

  test('rejects orphan after events and traces without a complete action', async () => {
    const orphan = await emptyFixture();
    await writeFile(
      orphan.raw,
      await zipBytes({
        'trace.trace': `${JSON.stringify({ type: 'context-options', version: 8, browserName: 'chromium' })}\n${JSON.stringify(
          {
            type: 'after',
            callId: 'call@orphan',
            endTime: 2,
          },
        )}\n`,
      }),
    );
    await expect(
      sanitizePlaywrightTrace({
        sourcePath: orphan.raw,
        outputPath: orphan.sanitized,
        provenancePath: orphan.provenance,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'TRACE_FORMAT_INVALID' });

    const noAction = await emptyFixture();
    await writeFile(
      noAction.raw,
      await zipBytes({
        'trace.trace': `${JSON.stringify({ type: 'context-options', version: 8, browserName: 'chromium' })}\n`,
      }),
    );
    await expect(
      sanitizePlaywrightTrace({
        sourcePath: noAction.raw,
        outputPath: noAction.sanitized,
        provenancePath: noAction.provenance,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'TRACE_FORMAT_INVALID' });
  });

  test('rejects a non-Chromium source instead of manufacturing browser provenance', async () => {
    const fixture = await emptyFixture();
    await writeFile(
      fixture.raw,
      await zipBytes({
        'trace.trace': `${JSON.stringify({ type: 'context-options', version: 8, browserName: 'firefox' })}\n${JSON.stringify(
          {
            type: 'action',
            callId: 'call@source',
            startTime: 1,
            endTime: 2,
            class: 'Frame',
            method: 'click',
            params: {},
          },
        )}\n`,
      }),
    );

    await expect(
      sanitizePlaywrightTrace({
        sourcePath: fixture.raw,
        outputPath: fixture.sanitized,
        provenancePath: fixture.provenance,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'TRACE_FORMAT_INVALID' });
  });

  test('keeps a pinned test-runner member neutral while requiring a Chromium sibling', async () => {
    const fixture = await emptyFixture();
    const testTimeline = `${JSON.stringify({
      type: 'context-options',
      version: 8,
      origin: 'testRunner',
      browserName: '',
    })}\n${JSON.stringify({
      type: 'action',
      callId: 'test@source',
      startTime: 1,
      endTime: 2,
      class: 'Test',
      method: 'test.step',
      params: {},
    })}\n`;
    await writeFile(
      fixture.raw,
      await zipBytes({ '0-trace.trace': validTimeline(), 'test.trace': testTimeline }),
    );

    await expect(
      sanitizePlaywrightTrace({
        sourcePath: fixture.raw,
        outputPath: fixture.sanitized,
        provenancePath: fixture.provenance,
      }),
    ).resolves.toMatchObject({ ok: true });
    const entries = await readArchive(fixture.sanitized);
    expect(entries.get('trace-001.trace')!.toString('utf8')).toContain('"browserName":"chromium"');
    expect(entries.get('trace-002.trace')!.toString('utf8')).toContain('"browserName":""');
    await expect(
      inspectPlaywrightTrace({
        tracePath: fixture.sanitized,
        provenancePath: fixture.provenance,
      }),
    ).resolves.toMatchObject({ ok: true });

    await writeFile(fixture.raw, await zipBytes({ 'test.trace': testTimeline }));
    await expect(
      sanitizePlaywrightTrace({
        sourcePath: fixture.raw,
        outputPath: fixture.sanitized,
        provenancePath: fixture.provenance,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'TRACE_FORMAT_INVALID' });
  });

  test('drops interrupted actions when another complete action remains', async () => {
    const fixture = await emptyFixture();
    await writeFile(
      fixture.raw,
      await zipBytes({
        'trace.trace': `${JSON.stringify({ type: 'context-options', version: 8, browserName: 'chromium' })}\n${JSON.stringify(
          {
            type: 'before',
            callId: 'call@interrupted',
            startTime: 1,
            class: 'Frame',
            method: 'click',
            params: {},
          },
        )}\n${JSON.stringify({
          type: 'action',
          callId: 'call@complete',
          startTime: 3,
          endTime: 4,
          class: 'Frame',
          method: 'click',
          params: {},
        })}\n`,
      }),
    );

    await expect(
      sanitizePlaywrightTrace({
        sourcePath: fixture.raw,
        outputPath: fixture.sanitized,
        provenancePath: fixture.provenance,
      }),
    ).resolves.toMatchObject({ ok: true });
    const text = (await readArchive(fixture.sanitized)).get('trace-001.trace')!.toString('utf8');
    expect(text).toContain('call@1');
    expect(text).not.toContain('call@2');
    await expect(
      inspectPlaywrightTrace({
        tracePath: fixture.sanitized,
        provenancePath: fixture.provenance,
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  test('rejects extra provenance fields and a forged output digest', async () => {
    const fixture = await traceFixture();
    const sanitized = await sanitizePlaywrightTrace({
      sourcePath: fixture.raw,
      outputPath: fixture.sanitized,
      provenancePath: fixture.provenance,
      forbiddenSubstrings: forbidden,
    });
    expect(sanitized.ok, JSON.stringify(sanitized)).toBe(true);
    const report = JSON.parse(await readFile(fixture.provenance, 'utf8')) as {
      output: { sha256: string };
      unexpected?: string;
    };
    report.unexpected = protectedToken;
    await writeFile(fixture.provenance, `${JSON.stringify(report)}\n`, 'utf8');
    await expect(
      inspectPlaywrightTrace({
        tracePath: fixture.sanitized,
        provenancePath: fixture.provenance,
        forbiddenSubstrings: forbidden,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'TRACE_PROVENANCE_INVALID' });

    delete report.unexpected;
    report.output.sha256 = '0'.repeat(64);
    await writeFile(fixture.provenance, `${JSON.stringify(report)}\n`, 'utf8');

    await expect(
      inspectPlaywrightTrace({
        tracePath: fixture.sanitized,
        provenancePath: fixture.provenance,
        forbiddenSubstrings: forbidden,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'TRACE_PROVENANCE_INVALID' });
  });

  test('rejects non-canonical provenance lexical encodings', async () => {
    const fixture = await traceFixture();
    await sanitizeFixture(fixture);
    const canonical = await readFile(fixture.provenance, 'utf8');
    const report = JSON.parse(canonical) as Record<string, unknown>;
    const reversed = Object.fromEntries(Object.entries(report).reverse());
    const variants = [
      `${JSON.stringify(report, null, 2)}\n`,
      `${canonical}\n`,
      canonical.replaceAll('\n', '\r\n'),
      `${JSON.stringify(reversed)}\n`,
      canonical.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
      canonical.replace('"schemaVersion":1', '"schemaVersion":1e0'),
      canonical.replace('"sanitizer"', '"san\\u0069tizer"'),
    ];
    expect(variants.every((value) => value !== canonical)).toBe(true);

    for (const bytes of variants) {
      await writeFile(fixture.provenance, bytes, 'utf8');
      await expect(
        inspectPlaywrightTrace({
          tracePath: fixture.sanitized,
          provenancePath: fixture.provenance,
        }),
      ).resolves.toMatchObject({ ok: false, code: 'TRACE_PROVENANCE_INVALID' });
    }
  });

  test('reconciles provenance action counts against the projected output', async () => {
    const fixture = await traceFixture();
    await sanitizeFixture(fixture);
    const report = JSON.parse(await readFile(fixture.provenance, 'utf8')) as {
      projection: { remappedActions: number; retainedActions: number };
    };
    report.projection.remappedActions = 0;
    report.projection.retainedActions = 0;
    await writeFile(fixture.provenance, `${JSON.stringify(report)}\n`, 'utf8');

    await expect(
      inspectPlaywrightTrace({
        tracePath: fixture.sanitized,
        provenancePath: fixture.provenance,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'TRACE_PROVENANCE_INVALID' });
  });

  test('rejects non-canonical trace JSONL lexical encodings', async () => {
    const fixture = await traceFixture();
    await sanitizeFixture(fixture);
    const canonicalEntries = await readArchive(fixture.sanitized);
    const member = canonicalEntries.get('trace-001.trace')!.toString('utf8');
    const [context, ...remaining] = member.trimEnd().split('\n');
    const parsed = JSON.parse(context!) as Record<string, unknown>;
    const reversed = JSON.stringify(Object.fromEntries(Object.entries(parsed).reverse()));
    const variants = [
      ` ${context}`,
      reversed,
      `${context}\r`,
      context!.replace('"version":8', '"version":8,"version":8'),
      context!.replace('"browserName":"chromium"', '"browserName":"chrom\\u0069um"'),
      context!.replace('"version":8', '"version":8e0'),
    ];

    for (const firstLine of variants) {
      const entries = new Map(canonicalEntries);
      entries.set('trace-001.trace', Buffer.from(`${[firstLine, ...remaining].join('\n')}\n`));
      const forged = await writeDeterministicArchive(entries);
      await writeFile(fixture.sanitized, forged);
      await refreshProvenanceForTrace(fixture, forged, entries);
      await expect(
        inspectPlaywrightTrace({
          tracePath: fixture.sanitized,
          provenancePath: fixture.provenance,
        }),
      ).resolves.toMatchObject({ ok: false, code: 'TRACE_RESIDUAL_SENSITIVE_DATA' });
    }
    for (const nonCanonicalMember of [`${member}\n`, `${member.trimEnd()} \n`]) {
      const entries = new Map(canonicalEntries);
      entries.set('trace-001.trace', Buffer.from(nonCanonicalMember));
      const forged = await writeDeterministicArchive(entries);
      await writeFile(fixture.sanitized, forged);
      await refreshProvenanceForTrace(fixture, forged, entries);
      await expect(
        inspectPlaywrightTrace({
          tracePath: fixture.sanitized,
          provenancePath: fixture.provenance,
        }),
      ).resolves.toMatchObject({ ok: false, code: 'TRACE_RESIDUAL_SENSITIVE_DATA' });
    }
  });

  test('rejects invalid UTF-8 in retained trace and provenance bytes', async () => {
    const fixture = await traceFixture();
    await sanitizeFixture(fixture);
    const canonicalReport = await readFile(fixture.provenance);
    await writeFile(
      fixture.provenance,
      Buffer.concat([
        canonicalReport.subarray(0, 1),
        Buffer.from([0xff]),
        canonicalReport.subarray(1),
      ]),
    );
    await expect(
      inspectPlaywrightTrace({
        tracePath: fixture.sanitized,
        provenancePath: fixture.provenance,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'TRACE_PROVENANCE_INVALID' });

    await writeFile(fixture.provenance, canonicalReport);
    const entries = await readArchive(fixture.sanitized);
    const [name, bytes] = entries.entries().next().value!;
    entries.set(name, Buffer.concat([Buffer.from([0xff]), bytes]));
    const forged = await writeDeterministicArchive(entries);
    await writeFile(fixture.sanitized, forged);
    await refreshProvenanceForTrace(fixture, forged, entries);
    await expect(
      inspectPlaywrightTrace({
        tracePath: fixture.sanitized,
        provenancePath: fixture.provenance,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'TRACE_FORMAT_INVALID' });
  });

  test('rejects every non-canonical ZIP metadata channel on retained output', async () => {
    const fixture = await traceFixture();
    await sanitizeFixture(fixture);
    const canonical = await readFile(fixture.sanitized);
    const canonicalEntries = await readArchive(canonical);
    const variants: ReadonlyArray<readonly [string, Buffer]> = [
      ['archive comment', withArchiveComment(canonical, Buffer.from('archive-metadata'))],
      ['file comment', withFileComment(canonical, Buffer.from('entry-metadata'))],
      ['central extra', withCentralExtra(canonical, Buffer.from([0xfe, 0xca, 0, 0]))],
      ['local extra', withLocalExtra(canonical, Buffer.from([0xfe, 0xca, 0, 0]))],
      ['member order', await writeArchiveInOrder([...canonicalEntries].reverse())],
      ['DOS timestamp', withDosTimestamp(canonical, 1, 1)],
      ['external attributes', withExternalAttributes(canonical, 0o100600)],
      ['unclaimed trailing byte', Buffer.concat([canonical, Buffer.from([0])])],
    ];

    for (const [name, forged] of variants) {
      await writeFile(fixture.sanitized, forged);
      const entries = await readArchive(forged).catch(() => canonicalEntries);
      await refreshProvenanceForTrace(fixture, forged, entries);
      const result = await inspectPlaywrightTrace({
        tracePath: fixture.sanitized,
        provenancePath: fixture.provenance,
      });
      expect(result.ok, `${name} was accepted`).toBe(false);
      if (result.ok) continue;
      expect(['TRACE_RESIDUAL_SENSITIVE_DATA', 'TRACE_ZIP_INVALID']).toContain(result.code);
      await expect(
        inspectPlaywrightTrace({
          tracePath: fixture.sanitized,
          provenancePath: fixture.provenance,
        }),
      ).resolves.toMatchObject({ ok: false });
    }
  });

  test('bounds an untrusted provenance sidecar before parsing it', async () => {
    const fixture = await traceFixture();
    const sanitized = await sanitizePlaywrightTrace({
      sourcePath: fixture.raw,
      outputPath: fixture.sanitized,
      provenancePath: fixture.provenance,
      forbiddenSubstrings: forbidden,
    });
    expect(sanitized.ok, JSON.stringify(sanitized)).toBe(true);
    await writeFile(fixture.provenance, Buffer.alloc(1024 * 1024 + 1));

    await expect(
      inspectPlaywrightTrace({
        tracePath: fixture.sanitized,
        provenancePath: fixture.provenance,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'TRACE_PROVENANCE_INVALID' });
  });

  test('rejects deeply nested provenance before JSON parsing', async () => {
    const fixture = await traceFixture();
    await sanitizeFixture(fixture);
    const nested = Array.from({ length: 70 }).reduce<unknown>((value) => [value], 'leaf');
    await writeFile(fixture.provenance, JSON.stringify({ nested }), 'utf8');

    await expect(
      inspectPlaywrightTrace({
        tracePath: fixture.sanitized,
        provenancePath: fixture.provenance,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'TRACE_PROVENANCE_INVALID' });
  });

  test('independent inspection rejects a forged inline base64 payload', async () => {
    const fixture = await traceFixture();
    const sanitized = await sanitizePlaywrightTrace({
      sourcePath: fixture.raw,
      outputPath: fixture.sanitized,
      provenancePath: fixture.provenance,
      forbiddenSubstrings: forbidden,
    });
    expect(sanitized.ok, JSON.stringify(sanitized)).toBe(true);
    const entries = await readArchive(fixture.sanitized);
    const encoded = Buffer.from(protectedToken).toString('base64');
    entries.set(
      'trace-001.trace',
      Buffer.concat([
        entries.get('trace-001.trace')!,
        Buffer.from(`${JSON.stringify({ type: 'stdout', timestamp: 1, base64: encoded })}\n`),
      ]),
    );
    const forgedTrace = await writeDeterministicArchive(entries);
    const report = JSON.parse(await readFile(fixture.provenance, 'utf8')) as {
      output: { sha256: string; size: number };
      residualScan: { passed: true; scannedEntries: number; scannedBytes: number };
      logicalMembers: string[];
    };
    report.output = {
      sha256: createHash('sha256').update(forgedTrace).digest('hex'),
      size: forgedTrace.byteLength,
    };
    report.residualScan = {
      passed: true,
      scannedBytes: [...entries.values()].reduce((total, bytes) => total + bytes.byteLength, 0),
      scannedEntries: entries.size,
    };
    await writeFile(fixture.sanitized, forgedTrace);
    await writeFile(fixture.provenance, `${JSON.stringify(report)}\n`, 'utf8');
    expect(
      createHash('sha256')
        .update(await readFile(fixture.sanitized))
        .digest('hex'),
    ).toBe(report.output.sha256);
    expect(
      [...(await readArchive(fixture.sanitized)).keys()]
        .filter((name) => /\.(?:trace|network|stacks)$/u.test(name))
        .sort(),
    ).toEqual(report.logicalMembers);

    await expect(
      inspectPlaywrightTrace({
        tracePath: fixture.sanitized,
        provenancePath: fixture.provenance,
        forbiddenSubstrings: forbidden,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'TRACE_RESIDUAL_SENSITIVE_DATA' });
  });

  test('drops arbitrary Sha1-suffixed fields and their resource members', async () => {
    const fixture = await emptyFixture();
    const fakeReference = `${opaqueHashCanary}.txt`;
    await writeFile(
      fixture.raw,
      await zipBytes({
        'trace.trace': `${JSON.stringify({
          type: 'context-options',
          version: 8,
          browserName: 'chromium',
          tokenSha1: fakeReference,
          unknown: { sha1: fakeReference },
        })}\n${JSON.stringify({
          type: 'action',
          callId: 'call@source',
          startTime: 1,
          endTime: 2,
          class: 'Frame',
          method: 'click',
          params: {},
        })}\n`,
        [`resources/${fakeReference}`]: 'ordinary bytes',
      }),
    );

    const result = await sanitizePlaywrightTrace({
      sourcePath: fixture.raw,
      outputPath: fixture.sanitized,
      provenancePath: fixture.provenance,
      forbiddenSubstrings: [opaqueHashCanary],
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    const entries = await readArchive(fixture.sanitized);
    expect(Buffer.concat([...entries.values()]).toString('utf8')).not.toContain(opaqueHashCanary);
    expect(entries.has(`resources/${fakeReference}`)).toBe(false);
  });

  test('drops attachment and snapshot references with every resource member', async () => {
    const fixture = await emptyFixture();
    const afterRef = `${'4'.repeat(40)}.txt`;
    const actionRef = `${'5'.repeat(40)}.txt`;
    const overrideRef = `${'6'.repeat(40)}.dat`;
    const opaqueRef = `${'7'.repeat(40)}.dat`;
    const fakeRef = `${opaqueHashCanary}.txt`;
    await writeFile(
      fixture.raw,
      await zipBytes({
        'trace.trace': [
          { type: 'context-options', version: 8, browserName: 'chromium' },
          {
            type: 'before',
            callId: 'call@1',
            startTime: 1,
            class: 'Frame',
            method: 'click',
            params: {},
          },
          {
            type: 'after',
            callId: 'call@1',
            endTime: 2,
            attachments: [{ name: 'after', contentType: 'text/plain', sha1: afterRef }],
          },
          {
            type: 'action',
            callId: 'call@2',
            startTime: 1,
            endTime: 2,
            class: 'Frame',
            method: 'click',
            params: {},
            attachments: [
              { name: 'modernized', contentType: 'text/plain', sha1: actionRef },
              { name: 'opaque', contentType: 'application/octet-stream', sha1: opaqueRef },
            ],
          },
          {
            type: 'frame-snapshot',
            snapshot: {
              resourceOverrides: [{ url: 'https://example.test/image.png', sha1: overrideRef }],
            },
          },
          {
            type: 'before',
            callId: 'call@3',
            startTime: 1,
            class: 'Frame',
            method: 'click',
            params: {},
            attachments: [{ name: 'not-allowed', contentType: 'text/plain', sha1: fakeRef }],
          },
          { type: 'after', callId: 'call@3', endTime: 2 },
        ]
          .map((event) => JSON.stringify(event))
          .join('\n')
          .concat('\n'),
        [`resources/${afterRef}`]: 'safe after attachment',
        [`resources/${actionRef}`]: 'safe modernized attachment',
        [`resources/${overrideRef}`]: 'safe override bytes',
        [`resources/${opaqueRef}`]: Buffer.concat([
          Buffer.from([0x00, 0xff, 0x01, 0xfe]),
          Buffer.from(protectedToken),
        ]),
        [`resources/${fakeRef}`]: 'must not be retained',
      }),
    );

    const result = await sanitizePlaywrightTrace({
      sourcePath: fixture.raw,
      outputPath: fixture.sanitized,
      provenancePath: fixture.provenance,
      forbiddenSubstrings: [opaqueHashCanary, protectedToken],
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    const entries = await readArchive(fixture.sanitized);
    expect(entries.has(`resources/${afterRef}`)).toBe(false);
    expect(entries.has(`resources/${actionRef}`)).toBe(false);
    expect(entries.has(`resources/${overrideRef}`)).toBe(false);
    expect(entries.has(`resources/${opaqueRef}`)).toBe(false);
    expect(entries.has(`resources/${fakeRef}`)).toBe(false);
    expect(entries.get('trace-001.trace')!.toString('utf8')).not.toContain(opaqueHashCanary);
  });

  test('omits snapshots, network data, form values, headers, and encoded payloads', async () => {
    const fixture = await emptyFixture();
    const pathToken = 'opaque-reset-path-token-12345';
    const fragmentToken = 'opaque-fragment-token';
    const domValue = 'ordinary-dom-field-value';
    const sessionId = 'ordinary-session-id-value';
    const accessToken = 'ordinary-access-token-value';
    const requestId = 'ordinary-request-id-value';
    const camelAuthToken = 'ordinary-camel-auth-token-value';
    const camelSessionId = 'ordinary-camel-session-id-value';
    const plainDataUriValue = 'ordinary-plain-data-uri-value';
    const inlineValue = 'ordinary-inline-payload-value';
    const encoded = Buffer.from(inlineValue).toString('base64');
    await writeFile(
      fixture.raw,
      await zipBytes({
        'trace.trace': [
          { type: 'context-options', version: 8, browserName: 'chromium' },
          {
            type: 'before',
            callId: 'call@1',
            startTime: 0,
            class: 'Frame',
            method: 'click',
            params: {},
          },
          {
            type: 'frame-snapshot',
            snapshot: {
              frameUrl: `http://user:pass@example.test/reset/${pathToken}?next=${pathToken}#${fragmentToken}`,
              html: [
                'INPUT',
                { name: 'token', type: 'password', value: domValue },
                ['A', { href: `https://example.test/callback/${pathToken}#${fragmentToken}` }],
              ],
              resourceOverrides: [],
            },
          },
          {
            type: 'after',
            callId: 'call@1',
            endTime: 1,
            attachments: [{ name: 'inline', contentType: 'text/plain', base64: encoded }],
          },
          {
            type: 'frame-snapshot',
            snapshot: {
              frameUrl: `data:text/plain,${plainDataUriValue}`,
              html: ['HTML', {}, ['BODY', {}, 'opaque inline document']],
              resourceOverrides: [],
            },
          },
          { type: 'stdout', timestamp: 1, base64: encoded },
          {
            type: 'log',
            callId: 'call@1',
            time: 1,
            message: `notice: data:text/plain;base64,${encoded}`,
          },
        ]
          .map((event) => JSON.stringify(event))
          .join('\n')
          .concat('\n'),
        'trace.network': `${JSON.stringify({
          type: 'resource-snapshot',
          snapshot: {
            request: {
              method: 'GET',
              url: `https://example.test/session/${pathToken}?value=${pathToken}#${fragmentToken}`,
              headers: [
                { name: 'X-Session-Id', value: sessionId },
                { name: 'X-Access-Token', value: accessToken },
                { name: 'XAuthToken', value: camelAuthToken },
                { name: 'XSessionId', value: camelSessionId },
                { name: 'X-Request-Id', value: requestId },
              ],
              cookies: [],
              queryString: [],
            },
            response: {
              headers: [],
              cookies: [],
              content: { mimeType: 'text/plain', encoding: 'base64', text: encoded },
            },
          },
        })}\n`,
      }),
    );

    const result = await sanitizePlaywrightTrace({
      sourcePath: fixture.raw,
      outputPath: fixture.sanitized,
      provenancePath: fixture.provenance,
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    const entries = await readArchive(fixture.sanitized);
    const allText = Buffer.concat([...entries.values()]).toString('utf8');
    for (const residual of [
      pathToken,
      fragmentToken,
      domValue,
      sessionId,
      accessToken,
      camelAuthToken,
      camelSessionId,
      plainDataUriValue,
      inlineValue,
      encoded,
    ]) {
      expect(allText).not.toContain(residual);
    }
    expect(allText).not.toContain(requestId);
    expect(allText).not.toContain('"base64"');
    expect(allText).not.toContain('"encoding":"base64"');
    await expect(
      inspectPlaywrightTrace({
        tracePath: fixture.sanitized,
        provenancePath: fixture.provenance,
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  test('drops every action parameter including sensitive keys and benign controls', async () => {
    const fixture = await emptyFixture();
    const arbitraryValues = {
      accessToken: 'ordinary-access-value',
      sessionId: 'ordinary-session-value',
      apiKey: 'ordinary-api-value',
      clientSecret: 'ordinary-client-value',
      refreshToken: 'ordinary-refresh-value',
      passwordHash: 'ordinary-hash-value',
    };
    await writeFile(
      fixture.raw,
      await zipBytes({
        'trace.trace': `${JSON.stringify({ type: 'context-options', version: 8, browserName: 'chromium' })}\n${JSON.stringify(
          {
            type: 'action',
            callId: 'call@1',
            startTime: 1,
            endTime: 2,
            class: 'Frame',
            method: 'click',
            params: {
              ...arbitraryValues,
              nested: { refreshToken: arbitraryValues.refreshToken },
              requestId: 'request-control',
              monkey: 'monkey-control',
              tokenizer: 'tokenizer-control',
            },
          },
        )}\n`,
      }),
    );

    const result = await sanitizePlaywrightTrace({
      sourcePath: fixture.raw,
      outputPath: fixture.sanitized,
      provenancePath: fixture.provenance,
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    const event = JSON.parse(
      (await readArchive(fixture.sanitized))
        .get('trace-001.trace')!
        .toString('utf8')
        .trim()
        .split('\n')[1]!,
    ) as { params: Record<string, unknown> };
    expect(event.params).toEqual({});
  });

  test('maps free-form action metadata, identifiers, and numeric channels to fixed values', async () => {
    const fixture = await emptyFixture();
    const stringCanary = 'ArbitraryMetadataCanaryValue';
    const numericCanary = 73_400_321;
    await writeFile(
      fixture.raw,
      await zipBytes({
        'trace.trace': `${JSON.stringify({
          type: 'context-options',
          version: 8,
          browserName: 'chromium',
          contextId: stringCanary,
          wallTime: numericCanary,
          monotonicTime: numericCanary,
          options: { viewport: { width: numericCanary, height: numericCanary } },
        })}\n${JSON.stringify({
          type: 'action',
          callId: stringCanary,
          startTime: numericCanary,
          endTime: numericCanary + 1,
          class: 'Frame',
          method: 'click',
          apiName: stringCanary,
          params: {},
        })}\n${JSON.stringify({
          type: 'action',
          callId: `${stringCanary}Unknown`,
          startTime: numericCanary + 2,
          endTime: numericCanary + 3,
          class: stringCanary,
          method: stringCanary,
          apiName: stringCanary,
          params: {},
        })}\n`,
      }),
    );

    await expect(
      sanitizePlaywrightTrace({
        sourcePath: fixture.raw,
        outputPath: fixture.sanitized,
        provenancePath: fixture.provenance,
      }),
    ).resolves.toMatchObject({ ok: true });
    const text = (await readArchive(fixture.sanitized)).get('trace-001.trace')!.toString('utf8');
    expect(text).not.toContain(stringCanary);
    expect(text).not.toContain(String(numericCanary));
    expect(text).toContain('"contextId":"context@1"');
    expect(text).toContain('"apiName":"Frame.click"');
    expect(text).toContain('"startTime":1');
    expect(text).toContain('"endTime":2');
  });

  test.each([
    ['unknown-only', 'ArbitraryClassCanary', 'ArbitraryMethodCanary'],
    ['invented Cartesian pair', 'BrowserContext', 'fill'],
  ])('rejects an %s action timeline', async (_name, actionClass, method) => {
    const fixture = await emptyFixture();
    await writeFile(
      fixture.raw,
      await zipBytes({
        'trace.trace': `${JSON.stringify({ type: 'context-options', version: 8, browserName: 'chromium' })}\n${JSON.stringify(
          {
            type: 'action',
            callId: 'call@unknown',
            startTime: 1,
            endTime: 2,
            class: actionClass,
            method,
            params: {},
          },
        )}\n`,
      }),
    );

    await expect(
      sanitizePlaywrightTrace({
        sourcePath: fixture.raw,
        outputPath: fixture.sanitized,
        provenancePath: fixture.provenance,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'TRACE_FORMAT_INVALID' });
  });

  test('drops every referenced resource body instead of trusting text encodings', async () => {
    const fixture = await emptyFixture();
    const htmlRef = `${'8'.repeat(40)}.html`;
    const jsonRef = `${'9'.repeat(40)}.json`;
    const resourceFormValue = 'ordinary-resource-form-value';
    const resourceJsonValue = 'ordinary-resource-json-value';
    await writeFile(
      fixture.raw,
      await zipBytes({
        'trace.trace': validTimeline(),
        'trace.network': [
          {
            type: 'resource-snapshot',
            snapshot: resourceSnapshot('text/html', htmlRef),
          },
          {
            type: 'resource-snapshot',
            snapshot: resourceSnapshot('application/json', jsonRef),
          },
        ]
          .map((event) => JSON.stringify(event))
          .join('\n')
          .concat('\n'),
        [`resources/${htmlRef}`]: `<input type="password" value="${resourceFormValue}">`,
        [`resources/${jsonRef}`]: JSON.stringify({ password: resourceJsonValue }),
      }),
    );

    await expect(
      sanitizePlaywrightTrace({
        sourcePath: fixture.raw,
        outputPath: fixture.sanitized,
        provenancePath: fixture.provenance,
      }),
    ).resolves.toMatchObject({ ok: true });
    const entries = await readArchive(fixture.sanitized);
    expect([...entries.keys()].some((name) => name.startsWith('resources/'))).toBe(false);
    const text = Buffer.concat([...entries.values()]).toString('utf8');
    expect(text).not.toContain(htmlRef);
    expect(text).not.toContain(jsonRef);
    expect(text).not.toContain(resourceFormValue);
    expect(text).not.toContain(resourceJsonValue);
  });

  test('independent inspection rejects forged network/header content', async () => {
    const fixture = await traceFixture();
    await sanitizeFixture(fixture);
    await appendForgedEvent(fixture, 'trace-001.trace', {
      type: 'resource-snapshot',
      snapshot: {
        ...resourceSnapshot('text/plain'),
        request: {
          method: 'GET',
          url: 'https://example.test/',
          headers: [
            { name: 'XAuthToken', value: 'ordinary-forged-header-value' },
            { name: 'XRequestId', value: 'ordinary-request-control' },
          ],
          cookies: [],
          queryString: [],
        },
      },
    });

    await expect(
      inspectPlaywrightTrace({
        tracePath: fixture.sanitized,
        provenancePath: fixture.provenance,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'TRACE_RESIDUAL_SENSITIVE_DATA' });
  });

  test('independent inspection rejects a forged non-base64 data URL', async () => {
    const fixture = await traceFixture();
    await sanitizeFixture(fixture);
    await appendForgedEvent(fixture, 'trace-001.trace', {
      type: 'frame-snapshot',
      snapshot: {
        frameUrl: 'data:text/plain,ordinary-forged-inline-value',
        html: ['HTML', {}, ['BODY', {}, 'inline']],
        resourceOverrides: [],
      },
    });

    await expect(
      inspectPlaywrightTrace({
        tracePath: fixture.sanitized,
        provenancePath: fixture.provenance,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'TRACE_RESIDUAL_SENSITIVE_DATA' });
  });

  test('independent inspection rejects a forged camelCase action token', async () => {
    const fixture = await traceFixture();
    const sanitized = await sanitizePlaywrightTrace({
      sourcePath: fixture.raw,
      outputPath: fixture.sanitized,
      provenancePath: fixture.provenance,
      forbiddenSubstrings: forbidden,
    });
    expect(sanitized.ok, JSON.stringify(sanitized)).toBe(true);
    const entries = await readArchive(fixture.sanitized);
    entries.set(
      'trace-001.trace',
      Buffer.concat([
        entries.get('trace-001.trace')!,
        Buffer.from(
          `${JSON.stringify({
            type: 'action',
            callId: 'call@9',
            startTime: 1,
            endTime: 2,
            class: 'Frame',
            method: 'click',
            params: { accessToken: 'ordinary-forged-action-value' },
          })}\n`,
        ),
      ]),
    );
    const forgedTrace = await writeDeterministicArchive(entries);
    const report = JSON.parse(await readFile(fixture.provenance, 'utf8')) as {
      output: { sha256: string; size: number };
      residualScan: { passed: true; scannedEntries: number; scannedBytes: number };
    };
    report.output = {
      sha256: createHash('sha256').update(forgedTrace).digest('hex'),
      size: forgedTrace.byteLength,
    };
    report.residualScan = {
      passed: true,
      scannedBytes: [...entries.values()].reduce((total, bytes) => total + bytes.byteLength, 0),
      scannedEntries: entries.size,
    };
    await writeFile(fixture.sanitized, forgedTrace);
    await writeFile(fixture.provenance, `${JSON.stringify(report)}\n`, 'utf8');

    await expect(
      inspectPlaywrightTrace({
        tracePath: fixture.sanitized,
        provenancePath: fixture.provenance,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'TRACE_RESIDUAL_SENSITIVE_DATA' });
  });

  test('drops schema-valid resource names even when the opaque name is a canary', async () => {
    const fixture = await emptyFixture();
    const reference = `${opaqueHashCanary}.txt`;
    await writeFile(
      fixture.raw,
      await zipBytes({
        'trace.trace': `${JSON.stringify({ type: 'context-options', version: 8, browserName: 'chromium' })}\n${JSON.stringify(
          {
            type: 'action',
            callId: 'call@1',
            startTime: 0,
            endTime: 1,
            class: 'Frame',
            method: 'click',
            params: {},
            attachments: [{ name: 'proof', contentType: 'text/plain', sha1: reference }],
          },
        )}\n`,
        [`resources/${reference}`]: 'ordinary attachment',
      }),
    );

    await expect(
      sanitizePlaywrightTrace({
        sourcePath: fixture.raw,
        outputPath: fixture.sanitized,
        provenancePath: fixture.provenance,
        forbiddenSubstrings: [opaqueHashCanary],
      }),
    ).resolves.toMatchObject({ ok: true });
    const entries = await readArchive(fixture.sanitized);
    expect([...entries.keys()].some((name) => name.startsWith('resources/'))).toBe(false);
    expect(Buffer.concat([...entries.values()]).toString('utf8')).not.toContain(opaqueHashCanary);
  });

  test('normalizes sensitive source logical member names', async () => {
    const fixture = await emptyFixture();
    await writeFile(fixture.raw, await validArchive(`${protectedToken}.trace`));

    await expect(
      sanitizePlaywrightTrace({
        sourcePath: fixture.raw,
        outputPath: fixture.sanitized,
        provenancePath: fixture.provenance,
        forbiddenSubstrings: [protectedToken],
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(await readArchive(fixture.sanitized)).toHaveProperty('size', 1);
    expect((await readArchive(fixture.sanitized)).has('trace-001.trace')).toBe(true);
  });

  test('rejects a resource-only archive after dropping opaque screencast data', async () => {
    const fixture = await emptyFixture();
    await writeFile(
      fixture.raw,
      await zipBytes({
        'trace.trace': `${JSON.stringify({
          type: 'screencast-frame',
          sha1: protectedToken,
        })}\n`,
        [`resources/${protectedToken}`]: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      }),
    );

    await expect(
      sanitizePlaywrightTrace({
        sourcePath: fixture.raw,
        outputPath: fixture.sanitized,
        provenancePath: fixture.provenance,
        forbiddenSubstrings: forbidden,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'TRACE_FORMAT_INVALID' });
  });
});

async function traceFixture() {
  const fixture = await emptyFixture();
  const action = {
    type: 'before',
    callId: 'call@1',
    startTime: 1,
    class: 'Frame',
    method: 'fill',
    params: {
      selector: 'internal:label=Email',
      value: protectedEmail,
      nested: { secret: protectedToken },
    },
    stack: [{ file: '/home/private/spec.ts', line: 1, column: 1 }],
    unknown: {
      note: protectedPassword,
      ordinaryOpaque: screencastRef,
      ordinaryArray: [screencastRef, `at /home/private/${protectedToken}.ts:1:1`],
    },
  };
  const context = {
    type: 'context-options',
    version: 8,
    origin: 'testRunner',
    browserName: 'chromium',
    playwrightVersion: '1.62.1',
    options: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
    platform: 'linux',
    wallTime: 1,
    monotonicTime: 1,
    sdkLanguage: 'javascript',
    contextId: 'context@1',
    title: 'sanitizer proof',
  };
  const network = {
    type: 'resource-snapshot',
    snapshot: {
      request: {
        method: 'POST',
        url: `http://127.0.0.1/login?token=${protectedToken}&email=${protectedEmail}`,
        headers: [
          { name: 'Cookie', value: `session=${protectedToken}` },
          { name: 'Authorization', value: `Bearer ${protectedToken}` },
          { name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
        ],
        cookies: [{ name: 'session', value: protectedToken }],
        queryString: [{ name: 'email', value: protectedEmail }],
        postData: {
          mimeType: 'application/x-www-form-urlencoded',
          text: `email=${protectedEmail}&password=${protectedPassword}`,
          params: [{ name: 'password', value: protectedPassword }],
          _sha1: requestBodyRef,
        },
      },
      response: {
        status: 200,
        statusText: 'OK',
        headers: [{ name: 'Set-Cookie', value: `session=${protectedToken}` }],
        cookies: [{ name: 'session', value: protectedToken }],
        content: { mimeType: 'text/html', _sha1: responseBodyRef, size: 1 },
      },
      unknown: { nested: { value: protectedToken } },
    },
  };
  await writeFile(
    fixture.raw,
    await zipBytes({
      '0-trace.trace': `${JSON.stringify(context)}\n${JSON.stringify(action)}\n${JSON.stringify({
        type: 'after',
        callId: action.callId,
        endTime: 2,
      })}\n`,
      'test.trace': `${JSON.stringify(context)}\n${JSON.stringify(action)}\n${JSON.stringify({
        type: 'after',
        callId: action.callId,
        endTime: 2,
      })}\n${JSON.stringify({
        type: 'screencast-frame',
        sha1: screencastRef,
        timestamp: 1,
        pageId: 'page@1',
        width: 1,
        height: 1,
      })}\n`,
      'trace.trace': `${JSON.stringify(context)}\n${JSON.stringify(action)}\n${JSON.stringify({
        type: 'after',
        callId: action.callId,
        endTime: 2,
      })}\n`,
      'test.network': `${JSON.stringify(network)}\n`,
      'test.stacks': JSON.stringify({ files: ['/home/private/spec.ts'] }),
      [`resources/${requestBodyRef}`]: `password=${protectedPassword}`,
      [`resources/${responseBodyRef}`]: `<p>${protectedEmail}</p>`,
      [`resources/${screencastRef}`]: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      'resources/src@private-source.txt': `const token = '${protectedToken}';`,
      'resources/unreferenced.txt': protectedToken,
    }),
  );
  return fixture;
}

async function emptyFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-trace-sanitizer-'));
  temporaryDirectories.push(directory);
  const raw = join(directory, 'raw.zip');
  const sanitized = join(directory, 'sanitized.zip');
  return { directory, raw, sanitized, provenance: `${sanitized}.sanitization.json` };
}

function resourceSnapshot(mimeType: string, reference?: string) {
  return {
    request: {
      method: 'GET',
      url: 'https://example.test/',
      headers: [],
      cookies: [],
      queryString: [],
    },
    response: {
      status: 200,
      statusText: 'OK',
      headers: [],
      cookies: [],
      content: { mimeType, ...(reference ? { _sha1: reference } : {}) },
    },
  };
}

async function sanitizeFixture(fixture: Awaited<ReturnType<typeof emptyFixture>>) {
  const result = await sanitizePlaywrightTrace({
    sourcePath: fixture.raw,
    outputPath: fixture.sanitized,
    provenancePath: fixture.provenance,
    forbiddenSubstrings: forbidden,
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
}

async function appendForgedEvent(
  fixture: Awaited<ReturnType<typeof emptyFixture>>,
  member: string,
  event: unknown,
) {
  const entries = await readArchive(fixture.sanitized);
  entries.set(
    member,
    Buffer.concat([
      entries.get(member) ?? Buffer.alloc(0),
      Buffer.from(`${JSON.stringify(event)}\n`),
    ]),
  );
  const trace = await writeDeterministicArchive(entries);
  const report = JSON.parse(await readFile(fixture.provenance, 'utf8')) as {
    output: { sha256: string; size: number };
    residualScan: { passed: true; scannedEntries: number; scannedBytes: number };
  };
  report.output = {
    sha256: createHash('sha256').update(trace).digest('hex'),
    size: trace.byteLength,
  };
  report.residualScan = {
    passed: true,
    scannedBytes: [...entries.values()].reduce((total, bytes) => total + bytes.byteLength, 0),
    scannedEntries: entries.size,
  };
  await writeFile(fixture.sanitized, trace);
  await writeFile(fixture.provenance, `${JSON.stringify(report)}\n`, 'utf8');
}

async function refreshProvenanceForTrace(
  fixture: Awaited<ReturnType<typeof emptyFixture>>,
  trace: Buffer,
  entries: ReadonlyMap<string, Buffer>,
) {
  const report = JSON.parse(await readFile(fixture.provenance, 'utf8')) as {
    output: { sha256: string; size: number };
    residualScan: { passed: true; scannedEntries: number; scannedBytes: number };
  };
  report.output.sha256 = createHash('sha256').update(trace).digest('hex');
  report.output.size = trace.byteLength;
  report.residualScan.scannedEntries = entries.size;
  report.residualScan.scannedBytes = [...entries.values()].reduce(
    (total, bytes) => total + bytes.byteLength,
    0,
  );
  await writeFile(fixture.provenance, `${JSON.stringify(report)}\n`, 'utf8');
}

async function validArchive(...names: string[]): Promise<Buffer> {
  const entries = Object.fromEntries(
    (names.length ? names : ['trace.trace']).map((name) => [name, validTimeline()]),
  );
  return zipBytes(entries);
}

function validTimeline(): string {
  return `${JSON.stringify({ type: 'context-options', version: 8, browserName: 'chromium' })}\n${JSON.stringify(
    {
      type: 'action',
      callId: 'call@source',
      startTime: 1,
      endTime: 2,
      class: 'Frame',
      method: 'click',
      params: {},
    },
  )}\n`;
}

async function zipBytes(entries: Readonly<Record<string, string | Buffer>>): Promise<Buffer> {
  const zip = new ZipFile();
  for (const [name, value] of Object.entries(entries)) zip.addBuffer(Buffer.from(value), name);
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function writeArchiveInOrder(
  entries: ReadonlyArray<readonly [string, Buffer]>,
): Promise<Buffer> {
  const zip = new ZipFile();
  for (const [name, value] of entries) {
    zip.addBuffer(value, name, {
      mtime: new Date('1980-01-01T00:00:00.000Z'),
      mode: 0o100644,
      compress: false,
      forceDosTimestamp: true,
    });
  }
  zip.end({ forceZip64Format: false, comment: '' });
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function replaceAscii(bytes: Buffer, from: string, to: string): Buffer {
  expect(Buffer.byteLength(from)).toBe(Buffer.byteLength(to));
  const result = Buffer.from(bytes);
  let offset = 0;
  let replacements = 0;
  while ((offset = result.indexOf(from, offset, 'ascii')) !== -1) {
    result.write(to, offset, 'ascii');
    offset += to.length;
    replacements += 1;
  }
  expect(replacements).toBeGreaterThanOrEqual(2);
  return result;
}

const localHeaderSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const centralHeaderSignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
const eocdSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

function withArchiveComment(bytes: Buffer, comment: Buffer): Buffer {
  const result = Buffer.concat([Buffer.from(bytes), comment]);
  const eocd = bytes.lastIndexOf(eocdSignature);
  expect(eocd).toBeGreaterThanOrEqual(0);
  result.writeUInt16LE(comment.byteLength, eocd + 20);
  return result;
}

function withFileComment(bytes: Buffer, comment: Buffer): Buffer {
  const central = bytes.indexOf(centralHeaderSignature);
  const eocd = bytes.lastIndexOf(eocdSignature);
  expect(central).toBeGreaterThanOrEqual(0);
  expect(eocd).toBeGreaterThan(central);
  const insertAt =
    central + 46 + bytes.readUInt16LE(central + 28) + bytes.readUInt16LE(central + 30);
  const result = insertBytes(bytes, insertAt, comment);
  result.writeUInt16LE(comment.byteLength, central + 32);
  result.writeUInt32LE(
    bytes.readUInt32LE(eocd + 12) + comment.byteLength,
    eocd + comment.length + 12,
  );
  return result;
}

function withCentralExtra(bytes: Buffer, extra: Buffer): Buffer {
  const central = bytes.indexOf(centralHeaderSignature);
  const eocd = bytes.lastIndexOf(eocdSignature);
  expect(central).toBeGreaterThanOrEqual(0);
  expect(eocd).toBeGreaterThan(central);
  const insertAt = central + 46 + bytes.readUInt16LE(central + 28);
  const result = insertBytes(bytes, insertAt, extra);
  result.writeUInt16LE(extra.byteLength, central + 30);
  result.writeUInt32LE(bytes.readUInt32LE(eocd + 12) + extra.byteLength, eocd + extra.length + 12);
  return result;
}

function withLocalExtra(bytes: Buffer, extra: Buffer): Buffer {
  const local = bytes.indexOf(localHeaderSignature);
  const eocd = bytes.lastIndexOf(eocdSignature);
  expect(local).toBeGreaterThanOrEqual(0);
  expect(eocd).toBeGreaterThan(local);
  const insertAt = local + 30 + bytes.readUInt16LE(local + 26);
  const result = insertBytes(bytes, insertAt, extra);
  result.writeUInt16LE(extra.byteLength, local + 28);
  const resultEocd = eocd + extra.length;
  result.writeUInt32LE(bytes.readUInt32LE(eocd + 16) + extra.byteLength, resultEocd + 16);
  let central = result.readUInt32LE(resultEocd + 16);
  const entries = result.readUInt16LE(resultEocd + 10);
  for (let index = 0; index < entries; index += 1) {
    expect(result.subarray(central, central + 4)).toEqual(centralHeaderSignature);
    const relativeOffset = result.readUInt32LE(central + 42);
    if (relativeOffset >= insertAt) {
      result.writeUInt32LE(relativeOffset + extra.byteLength, central + 42);
    }
    central +=
      46 +
      result.readUInt16LE(central + 28) +
      result.readUInt16LE(central + 30) +
      result.readUInt16LE(central + 32);
  }
  return result;
}

function withDosTimestamp(bytes: Buffer, time: number, date: number): Buffer {
  const result = Buffer.from(bytes);
  const local = result.indexOf(localHeaderSignature);
  const central = result.indexOf(centralHeaderSignature);
  expect(local).toBeGreaterThanOrEqual(0);
  expect(central).toBeGreaterThanOrEqual(0);
  result.writeUInt16LE(time, local + 10);
  result.writeUInt16LE(date, local + 12);
  result.writeUInt16LE(time, central + 12);
  result.writeUInt16LE(date, central + 14);
  return result;
}

function withExternalAttributes(bytes: Buffer, unixMode: number): Buffer {
  const result = Buffer.from(bytes);
  const central = result.indexOf(centralHeaderSignature);
  expect(central).toBeGreaterThanOrEqual(0);
  const prior = result.readUInt32LE(central + 38);
  result.writeUInt32LE(((unixMode << 16) | (prior & 0xffff)) >>> 0, central + 38);
  return result;
}

function insertBytes(bytes: Buffer, offset: number, inserted: Buffer): Buffer {
  return Buffer.concat([bytes.subarray(0, offset), inserted, bytes.subarray(offset)]);
}
