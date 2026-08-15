import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { createInspectionManifest, writeInspectionManifest } from './inspection-manifest.mjs';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(new URL('./inspection-manifest.mjs', import.meta.url));
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('inspection manifest sad paths', () => {
  it('rejects a missing inspection root with a clear error', async () => {
    const missing = join(tmpdir(), `arxic-inspection-missing-${Date.now()}`);
    await expect(createInspectionManifest(missing)).rejects.toThrow(
      `Inspection root does not exist: ${missing}`,
    );
    await expect(execFileAsync('node', [scriptPath, missing])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(`Inspection root does not exist: ${missing}`),
    });
  });

  it('produces a clean empty manifest for an empty directory', async () => {
    const root = await temporaryDirectory();
    const { manifest, outputs } = await writeInspectionManifest(root);
    expect(manifest).toMatchObject({ schemaVersion: 1, screenshotCount: 0, groups: [] });
    expect(JSON.parse(await readFile(outputs.json, 'utf8'))).toMatchObject({
      screenshotCount: 0,
      groups: [],
    });
    expect(await readFile(outputs.signOff, 'utf8')).toContain('Screenshot count: 0');
  });
});

describe('inspection manifest census', () => {
  it('records every retained PNG with hash, dimensions, and a per-file sign-off row', async () => {
    const root = await temporaryDirectory();
    const first = join(root, 'bundle-alpha', 'run-1', 'first.png');
    const second = join(root, 'bundle-alpha', 'run-2', 'second.png');
    await writePng(first, 640, 480);
    await writePng(second, 320, 200);
    await writeFile(join(root, 'bundle-alpha', 'run-2', 'not-a-screenshot.txt'), 'stray', 'utf8');

    const { manifest, outputs } = await writeInspectionManifest(root);
    expect(manifest.screenshotCount).toBe(2);
    expect(manifest.groups).toEqual([
      {
        path: 'bundle-alpha/run-1',
        files: [
          {
            relativePath: 'bundle-alpha/run-1/first.png',
            byteSize: 24,
            sha256: createHash('sha256').update(pngBytes(640, 480)).digest('hex'),
            dimensions: { width: 640, height: 480 },
          },
        ],
      },
      {
        path: 'bundle-alpha/run-2',
        files: [
          {
            relativePath: 'bundle-alpha/run-2/second.png',
            byteSize: 24,
            sha256: createHash('sha256').update(pngBytes(320, 200)).digest('hex'),
            dimensions: { width: 320, height: 200 },
          },
        ],
      },
    ]);
    expect(await readFile(outputs.text, 'utf8')).toContain('640x480');
    const signOff = await readFile(outputs.signOff, 'utf8');
    expect(signOff).toContain('bundle-alpha/run-1/first.png');
    expect(signOff).toContain('bundle-alpha/run-2/second.png');
  });

  it('lists a retained JPEG without inventing PNG dimensions', async () => {
    const root = await temporaryDirectory();
    const jpeg = join(root, 'bundle-alpha', 'run-1', 'retained.jpg');
    await mkdir(dirname(jpeg), { recursive: true });
    await writeFile(jpeg, 'retained JPEG bytes', 'utf8');

    const manifest = await createInspectionManifest(root);
    expect(manifest.groups[0].files).toEqual([
      {
        relativePath: 'bundle-alpha/run-1/retained.jpg',
        byteSize: 19,
        sha256: createHash('sha256').update('retained JPEG bytes').digest('hex'),
        dimensionsNote: 'dimensions skipped: non-PNG',
      },
    ]);
  });

  it('marks symlinked screenshot files without following files or directories', async () => {
    const root = await temporaryDirectory();
    const external = await temporaryDirectory();
    const target = join(external, 'target.png');
    await writePng(target, 640, 480);
    await symlink(target, join(root, 'linked.png'));
    await mkdir(join(external, 'nested'), { recursive: true });
    await writePng(join(external, 'nested', 'hidden.png'), 320, 200);
    await symlink(external, join(root, 'linked-directory'));

    const { manifest, outputs } = await writeInspectionManifest(root);
    expect(manifest.screenshotCount).toBe(1);
    expect(manifest.groups[0].files[0]).toMatchObject({
      relativePath: 'linked.png',
      symlink: true,
      sha256Note: 'sha256 unavailable: symlink not followed',
      dimensionsNote: 'dimensions unavailable: symlink not followed',
    });
    expect(
      manifest.groups.flatMap((group) => group.files).map((file) => file.relativePath),
    ).not.toContain('linked-directory/nested/hidden.png');
    expect(await readFile(outputs.text, 'utf8')).toContain(
      'Caveat: symlinks require manual resolution by the inspector; targets were not followed.',
    );
  });
});

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'arxic-inspection-manifest-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writePng(path, width, height) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, pngBytes(width, height));
}

function pngBytes(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
