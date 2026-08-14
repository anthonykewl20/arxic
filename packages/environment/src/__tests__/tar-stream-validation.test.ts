import { access, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateTarArchive } from '../tar-archive-validation';
import { consumeSupervisorResultSpool } from '../worker-sandbox';

type TarEntry = Readonly<{ name: string; type?: string; data?: Uint8Array }>;

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function tar(entries: readonly TarEntry[]): Buffer {
  return Buffer.concat([...entries.flatMap(tarEntry), Buffer.alloc(1024)]);
}

function tarEntry(entry: TarEntry): readonly Buffer[] {
  const data = Buffer.from(entry.data ?? []);
  const header = Buffer.alloc(512);
  writeString(header, 0, 100, entry.name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, data.byteLength);
  writeOctal(header, 136, 12, 0);
  header[156] = (entry.type ?? '0').charCodeAt(0);
  writeString(header, 257, 6, 'ustar');
  writeString(header, 263, 2, '00');
  header.fill(0x20, 148, 156);
  writeOctalChecksum(header);
  const padding = Buffer.alloc((512 - (data.byteLength % 512)) % 512);
  return [header, data, padding];
}

function paxRecord(key: string, value: string): Buffer {
  const payload = `${key}=${value}\n`;
  let record = `0 ${payload}`;
  while (true) {
    const next = `${Buffer.byteLength(record)} ${payload}`;
    if (next === record) return Buffer.from(next);
    record = next;
  }
}

function writeString(buffer: Buffer, offset: number, length: number, value: string): void {
  Buffer.from(value).copy(buffer, offset, 0, length);
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  writeString(buffer, offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`);
}

function writeOctalChecksum(buffer: Buffer): void {
  const sum = buffer.reduce((total, byte) => total + byte, 0);
  writeString(buffer, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
}

async function archive(entries: readonly TarEntry[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-tar-validation-'));
  directories.push(directory);
  const path = join(directory, 'archive.tar');
  await writeFile(path, tar(entries));
  return path;
}

describe('validateTarArchive', () => {
  it('rejects a symbolic-link member', async () => {
    await expect(
      validateTarArchive(await archive([{ name: 'escape', type: '2' }])),
    ).rejects.toThrow('unsafe filesystem entry');
  });

  it('rejects a hard-link member', async () => {
    await expect(validateTarArchive(await archive([{ name: 'alias', type: '1' }]))).rejects.toThrow(
      'unsafe filesystem entry',
    );
  });

  it('rejects FIFO and device members', async () => {
    for (const type of ['3', '4', '6']) {
      await expect(validateTarArchive(await archive([{ name: 'unsafe', type }]))).rejects.toThrow(
        'unsafe filesystem entry',
      );
    }
  });

  it('rejects an absolute member path', async () => {
    await expect(validateTarArchive(await archive([{ name: '/etc/passwd' }]))).rejects.toThrow(
      'unsafe filesystem entry',
    );
  });

  it('rejects a member path containing traversal', async () => {
    await expect(validateTarArchive(await archive([{ name: 'safe/../escape' }]))).rejects.toThrow(
      'unsafe filesystem entry',
    );
  });

  it('rejects a PAX path override to an absolute path', async () => {
    await expect(
      validateTarArchive(
        await archive([
          { name: 'PaxHeader', type: 'x', data: paxRecord('path', '/etc/x') },
          { name: 'safe' },
        ]),
      ),
    ).rejects.toThrow('unsafe filesystem entry');
  });

  it('rejects a PAX type override to a symbolic link', async () => {
    await expect(
      validateTarArchive(
        await archive([
          { name: 'PaxHeader', type: 'x', data: paxRecord('type', 'symlink') },
          { name: 'safe' },
        ]),
      ),
    ).rejects.toThrow('unsafe filesystem entry');
  });

  it('rejects an embedded NUL in a PAX path override', async () => {
    await expect(
      validateTarArchive(
        await archive([
          { name: 'PaxHeader', type: 'x', data: paxRecord('path', 'safe/\0escape') },
          { name: 'safe' },
        ]),
      ),
    ).rejects.toThrow('unsafe filesystem entry');
  });

  it('rejects an embedded NUL in a GNU long-name record', async () => {
    await expect(
      validateTarArchive(
        await archive([
          { name: '././@LongLink', type: 'L', data: Buffer.from('safe\0escape\0') },
          { name: 'truncated-name' },
        ]),
      ),
    ).rejects.toThrow('unsafe filesystem entry');
  });

  it('cleans a fabricated supervisor spool and never creates staging when validation rejects it', async () => {
    const spoolDirectory = await mkdtemp(join(tmpdir(), 'arxic-worker-spool-'));
    directories.push(spoolDirectory);
    const stagingBefore = (await readdir(tmpdir()))
      .filter((name) => name.startsWith('arxic-worker-result-'))
      .sort();
    await writeFile(
      join(spoolDirectory, 'result.tar'),
      tar([
        { name: 'already-regular.txt', data: Buffer.from('safe') },
        { name: 'PaxHeader', type: 'x', data: paxRecord('path', '/etc/x') },
        { name: 'ignored-by-override.txt' },
      ]),
    );
    await expect(access(join(spoolDirectory, 'result.tar'))).resolves.toBeUndefined();

    await expect(
      consumeSupervisorResultSpool(spoolDirectory, {
        quotaBytes: 1024 * 1024,
        perFileBytes: 1024 * 1024,
        fileLimit: 16,
      }),
    ).rejects.toMatchObject({
      name: 'ArtifactImportError',
      reason: 'invalid',
      message: expect.stringContaining('unsafe filesystem entry'),
    });

    await expect(access(spoolDirectory)).rejects.toThrow();
    expect(
      (await readdir(tmpdir())).filter((name) => name.startsWith('arxic-worker-result-')).sort(),
    ).toEqual(stagingBefore);
  });

  it('accepts a GNU long-name record resolving to a regular file', async () => {
    const longName = `nested/${'x'.repeat(120)}/artifact.json`;
    await expect(
      validateTarArchive(
        await archive([
          { name: '././@LongLink', type: 'L', data: Buffer.from(`${longName}\0`) },
          { name: 'truncated-name', data: Buffer.from('{"safe":true}') },
        ]),
      ),
    ).resolves.toBeUndefined();
  });

  it('accepts plain directory and regular-file members', async () => {
    await expect(
      validateTarArchive(
        await archive([
          { name: './', type: '5' },
          { name: './nested/', type: '5' },
          { name: './nested/result.json', data: Buffer.from('{"safe":true}') },
        ]),
      ),
    ).resolves.toBeUndefined();
  });
});
