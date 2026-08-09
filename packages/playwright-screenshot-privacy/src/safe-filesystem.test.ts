import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  nodeSafeFilesystemOperations,
  readBoundedRegularFile,
  walkStableWorkspace,
  type SafeFilesystemOperations,
} from './safe-filesystem';

const directories: string[] = [];
const linuxTest = test.runIf(process.platform === 'linux');

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('descriptor-anchored no-follow filesystem inspection', () => {
  linuxTest(
    'rejects a directory swapped to an external symlink before descriptor descent',
    async () => {
      const workspace = await temporaryDirectory('arxic-screenshot-owned-workspace-');
      const external = await temporaryDirectory('arxic-screenshot-external-directory-');
      const owned = join(workspace, 'owned');
      const displaced = join(workspace, 'owned-before-swap');
      const externalMarker = join(external, 'external-marker.png');
      await mkdir(owned);
      await writeFile(join(owned, 'owned.txt'), 'owned bytes\n');
      await writeFile(externalMarker, 'external bytes\n');
      const operations = operationsWithOpenSwap(
        (path) => path.endsWith('/owned'),
        async () => {
          await rename(owned, displaced);
          await symlink(external, owned, 'dir');
        },
      );
      const visited: string[] = [];

      await expect(
        walkStableWorkspace(owned, {
          allowMissing: false,
          maximumDepth: 4,
          maximumEntriesPerDirectory: 16,
          maximumTotalEntries: 32,
          operations,
          onEntry: ({ absolutePath }) => {
            visited.push(absolutePath);
          },
          onFailure: failure,
        }),
      ).rejects.toThrow(/without following links/u);
      expect(visited).toEqual([]);
      await expect(readFile(externalMarker, 'utf8')).resolves.toBe('external bytes\n');
    },
  );

  linuxTest(
    'rejects a regular file swapped to an external symlink before no-follow open',
    async () => {
      const workspace = await temporaryDirectory('arxic-screenshot-owned-file-');
      const external = await temporaryDirectory('arxic-screenshot-external-file-');
      const owned = join(workspace, 'payload.bin');
      const displaced = join(workspace, 'payload-before-swap.bin');
      const externalFile = join(external, 'external.bin');
      await writeFile(owned, 'owned bytes\n');
      await writeFile(externalFile, 'external bytes\n');
      const operations = operationsWithOpenSwap(
        (path) => path.endsWith('/payload.bin'),
        async () => {
          await rename(owned, displaced);
          await symlink(externalFile, owned);
        },
      );

      await expect(
        readBoundedRegularFile(owned, {
          minimumBytes: 1,
          maximumBytes: 1024,
          operations,
          onFailure: failure,
        }),
      ).rejects.toThrow(/without following links/u);
      await expect(readFile(externalFile, 'utf8')).resolves.toBe('external bytes\n');
    },
  );

  linuxTest('rejects final and intermediate symlinks without reading external bytes', async () => {
    const workspace = await temporaryDirectory('arxic-screenshot-static-links-');
    const external = await temporaryDirectory('arxic-screenshot-static-external-');
    const externalFile = join(external, 'external.bin');
    const finalLink = join(workspace, 'final.bin');
    const directoryLink = join(workspace, 'external-directory');
    await writeFile(externalFile, 'external bytes\n');
    await symlink(externalFile, finalLink);
    await symlink(external, directoryLink, 'dir');

    await expect(readSafe(finalLink)).rejects.toThrow(/symbolic link/u);
    await expect(readSafe(join(directoryLink, 'external.bin'))).rejects.toThrow(/symbolic link/u);
    await expect(readFile(externalFile, 'utf8')).resolves.toBe('external bytes\n');
  });

  linuxTest('rejects a non-regular final path', async () => {
    const workspace = await temporaryDirectory('arxic-screenshot-nonregular-');
    const directory = join(workspace, 'not-a-file');
    await mkdir(directory);

    await expect(readSafe(directory)).rejects.toThrow(/path is not a regular file/u);
  });

  linuxTest(
    'enforces per-directory, total-entry, and depth bounds during streaming traversal',
    async () => {
      const workspace = await temporaryDirectory('arxic-screenshot-traversal-bounds-');
      const perDirectory = join(workspace, 'per-directory');
      const total = join(workspace, 'total');
      const depth = join(workspace, 'depth');
      await Promise.all([mkdir(perDirectory), mkdir(join(total, 'child'), { recursive: true })]);
      await Promise.all([
        writeFile(join(perDirectory, 'one.txt'), ''),
        writeFile(join(perDirectory, 'two.txt'), ''),
        writeFile(join(perDirectory, 'three.txt'), ''),
        writeFile(join(total, 'root.txt'), ''),
        writeFile(join(total, 'child/nested.txt'), ''),
        mkdir(join(depth, 'nested/deeper'), { recursive: true }),
      ]);

      await expect(walk(perDirectory, { maximumEntriesPerDirectory: 2 })).rejects.toThrow(
        /directory entry count exceeds/u,
      );
      await expect(
        walk(total, { maximumEntriesPerDirectory: 2, maximumTotalEntries: 2 }),
      ).rejects.toThrow(/directory traversal exceeds/u);
      await expect(walk(depth, { maximumDepth: 0 })).rejects.toThrow(/directory nesting exceeds/u);
    },
  );

  test('fails closed when descriptor-anchored no-follow support is unavailable', async () => {
    const operations: SafeFilesystemOperations = Object.freeze({
      ...nodeSafeFilesystemOperations,
      platform: 'win32',
      flags: Object.freeze({ ...nodeSafeFilesystemOperations.flags, noFollow: undefined }),
    });

    await expect(
      readBoundedRegularFile('/not-inspected', {
        minimumBytes: 1,
        maximumBytes: 16,
        operations,
        onFailure: failure,
      }),
    ).rejects.toThrow(/unsupported/u);
  });
});

function readSafe(path: string): Promise<Buffer> {
  return readBoundedRegularFile(path, {
    minimumBytes: 1,
    maximumBytes: 1024,
    onFailure: failure,
  });
}

function walk(
  path: string,
  overrides: Partial<{
    maximumDepth: number;
    maximumEntriesPerDirectory: number;
    maximumTotalEntries: number;
  }>,
): Promise<void> {
  return walkStableWorkspace(path, {
    allowMissing: false,
    maximumDepth: overrides.maximumDepth ?? 4,
    maximumEntriesPerDirectory: overrides.maximumEntriesPerDirectory ?? 16,
    maximumTotalEntries: overrides.maximumTotalEntries ?? 32,
    onEntry: () => undefined,
    onFailure: failure,
  });
}

function operationsWithOpenSwap(
  matches: (path: string) => boolean,
  swap: () => Promise<void>,
): SafeFilesystemOperations {
  let swapped = false;
  const swappingOpen: typeof nodeSafeFilesystemOperations.open = async (path, flags, mode) => {
    if (!swapped && matches(String(path))) {
      swapped = true;
      await swap();
    }
    return nodeSafeFilesystemOperations.open(path, flags, mode);
  };
  return Object.freeze({ ...nodeSafeFilesystemOperations, open: swappingOpen });
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  directories.push(path);
  return path;
}

function failure(message: string): never {
  throw new Error(message);
}
