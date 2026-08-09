import { constants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import type { Dir, Stats } from 'node:fs';
import { lstat as nodeLstat, open as nodeOpen, opendir as nodeOpendir } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';

type Failure = (message: string) => never;

export type SafeFilesystemOperations = Readonly<{
  lstat: typeof nodeLstat;
  open: typeof nodeOpen;
  opendir: typeof nodeOpendir;
  platform: NodeJS.Platform;
  flags: Readonly<{
    directory?: number;
    noFollow?: number;
    nonBlock?: number;
    readOnly: number;
  }>;
}>;

export type StableWorkspaceEntry = Readonly<{
  absolutePath: string;
  name: string;
  kind: 'regular-file' | 'symbolic-link';
  readPrefix: (length: number) => Promise<Buffer>;
}>;

export const nodeSafeFilesystemOperations: SafeFilesystemOperations = Object.freeze({
  lstat: nodeLstat,
  open: nodeOpen,
  opendir: nodeOpendir,
  platform: process.platform,
  flags: Object.freeze({
    directory: constants.O_DIRECTORY,
    noFollow: constants.O_NOFOLLOW,
    nonBlock: constants.O_NONBLOCK,
    readOnly: constants.O_RDONLY,
  }),
});

export async function readBoundedRegularFile(
  path: string,
  input: Readonly<{
    minimumBytes: number;
    maximumBytes: number;
    onFailure: Failure;
    operations?: SafeFilesystemOperations;
  }>,
): Promise<Buffer> {
  const operations = input.operations ?? nodeSafeFilesystemOperations;
  assertSupported(operations, input.onFailure);
  assertByteBounds(input.minimumBytes, input.maximumBytes, input.onFailure);
  let handle: FileHandle | undefined;
  try {
    handle = await openAnchoredRegularFile(resolve(path), operations);
    const opened = await handle.stat();
    if (opened.size < input.minimumBytes || opened.size > input.maximumBytes) {
      fail('regular file byte length is outside its bound');
    }
    const bytes = await readBoundedHandle(handle, input.maximumBytes);
    await assertOpenFileStillBound(resolve(path), handle, opened, operations);
    if (bytes.length !== opened.size) fail('regular file changed while it was read');
    return bytes;
  } catch (error) {
    return mapFailure(
      error,
      input.onFailure,
      'regular file could not be read without following links',
    );
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function readRegularFilePrefix(
  path: string,
  length: number,
  input: Readonly<{
    onFailure: Failure;
    operations?: SafeFilesystemOperations;
  }>,
): Promise<Buffer> {
  const operations = input.operations ?? nodeSafeFilesystemOperations;
  assertSupported(operations, input.onFailure);
  if (!Number.isSafeInteger(length) || length < 1 || length > 64 * 1024) {
    return input.onFailure('regular file prefix length is outside its bound');
  }
  let handle: FileHandle | undefined;
  try {
    handle = await openAnchoredRegularFile(resolve(path), operations);
    const opened = await handle.stat();
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    await assertOpenFileStillBound(resolve(path), handle, opened, operations);
    return buffer.subarray(0, bytesRead);
  } catch (error) {
    return mapFailure(
      error,
      input.onFailure,
      'regular file prefix could not be read without following links',
    );
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function walkStableWorkspace(
  path: string,
  input: Readonly<{
    allowMissing: boolean;
    maximumDepth: number;
    maximumEntriesPerDirectory: number;
    maximumTotalEntries: number;
    shouldDescend?: (absolutePath: string, name: string) => boolean;
    onEntry: (entry: StableWorkspaceEntry) => Promise<void> | void;
    onFailure: Failure;
    operations?: SafeFilesystemOperations;
  }>,
): Promise<void> {
  const operations = input.operations ?? nodeSafeFilesystemOperations;
  assertSupported(operations, input.onFailure);
  assertTraversalBounds(input, input.onFailure);
  const absolute = resolve(path);
  try {
    await operations.lstat(absolute);
  } catch (error) {
    if (input.allowMissing && hasCode(error, 'ENOENT')) return;
    return mapFailure(error, input.onFailure, 'workspace root is unavailable');
  }

  let root: FileHandle | undefined;
  const state = { entries: 0 };
  try {
    root = await openAnchoredDirectory(absolute, operations);
    await visitDirectory(root, absolute, 0, state, input, operations);
  } catch (error) {
    return mapFailure(
      error,
      input.onFailure,
      'workspace could not be traversed without following links',
    );
  } finally {
    await root?.close().catch(() => undefined);
  }
}

async function visitDirectory(
  handle: FileHandle,
  logicalPath: string,
  depth: number,
  state: { entries: number },
  input: Parameters<typeof walkStableWorkspace>[1],
  operations: SafeFilesystemOperations,
): Promise<void> {
  if (depth > input.maximumDepth) fail('artifact directory nesting exceeds its bound');
  const before = await handle.stat();
  assertDirectory(before);
  const beforePath = await operations.lstat(logicalPath);
  assertSameDirectory(before, before, beforePath, false);
  let directory: Dir | undefined;
  try {
    directory = await operations.opendir(`/proc/self/fd/${handle.fd}`, { bufferSize: 32 });
    let localEntries = 0;
    for await (const entry of directory) {
      localEntries += 1;
      state.entries += 1;
      if (localEntries > input.maximumEntriesPerDirectory) {
        fail('artifact directory entry count exceeds its bound');
      }
      if (state.entries > input.maximumTotalEntries) {
        fail('artifact directory traversal exceeds its bound');
      }
      const absolutePath = join(logicalPath, entry.name);
      if (entry.isSymbolicLink()) {
        await input.onEntry({
          absolutePath,
          name: entry.name,
          kind: 'symbolic-link',
          readPrefix: async () => fail('symbolic-link bytes cannot be read'),
        });
      } else if (entry.isDirectory()) {
        if (input.shouldDescend && !input.shouldDescend(absolutePath, entry.name)) continue;
        let child: FileHandle | undefined;
        try {
          child = await openChildDirectory(handle, entry.name, absolutePath, operations);
          await visitDirectory(child, absolutePath, depth + 1, state, input, operations);
        } finally {
          await child?.close().catch(() => undefined);
        }
      } else if (entry.isFile()) {
        await input.onEntry({
          absolutePath,
          name: entry.name,
          kind: 'regular-file',
          readPrefix: (length) =>
            readChildFilePrefix(
              handle,
              entry.name,
              absolutePath,
              length,
              input.onFailure,
              operations,
            ),
        });
      } else {
        fail('workspace inventory contains a non-regular filesystem entry');
      }
    }
  } finally {
    await directory?.close().catch(() => undefined);
  }
  const [after, afterPath] = await Promise.all([handle.stat(), operations.lstat(logicalPath)]);
  assertSameDirectory(before, after, afterPath, true);
}

async function openAnchoredRegularFile(
  absolutePath: string,
  operations: SafeFilesystemOperations,
): Promise<FileHandle> {
  const before = await operations.lstat(absolutePath);
  assertRegularFile(before);
  let parent: FileHandle | undefined;
  let file: FileHandle | undefined;
  try {
    parent = await openAnchoredDirectory(dirname(absolutePath), operations);
    file = await operations.open(
      descriptorChildPath(parent, basename(absolutePath)),
      regularFileReadFlags(operations),
    );
    const opened = await file.stat();
    const afterPath = await operations.lstat(absolutePath);
    assertSameRegularFile(before, opened, afterPath);
    return file;
  } catch (error) {
    await file?.close().catch(() => undefined);
    throw error;
  } finally {
    await parent?.close().catch(() => undefined);
  }
}

async function openAnchoredDirectory(
  absolutePath: string,
  operations: SafeFilesystemOperations,
): Promise<FileHandle> {
  const target = resolve(absolutePath);
  const before = await operations.lstat(target);
  assertDirectory(before);
  let current = await operations.open(sep, directoryReadFlags(operations));
  try {
    for (const component of target.split(sep).filter(Boolean)) {
      const next = await operations.open(
        descriptorChildPath(current, component),
        directoryReadFlags(operations),
      );
      await current.close();
      current = next;
    }
    const opened = await current.stat();
    const afterPath = await operations.lstat(target);
    assertSameDirectory(before, opened, afterPath, false);
    return current;
  } catch (error) {
    await current.close().catch(() => undefined);
    throw error;
  }
}

async function openChildDirectory(
  parent: FileHandle,
  name: string,
  logicalPath: string,
  operations: SafeFilesystemOperations,
): Promise<FileHandle> {
  const before = await operations.lstat(logicalPath);
  assertDirectory(before);
  const child = await operations.open(
    descriptorChildPath(parent, name),
    directoryReadFlags(operations),
  );
  try {
    const opened = await child.stat();
    const afterPath = await operations.lstat(logicalPath);
    assertSameDirectory(before, opened, afterPath, false);
    return child;
  } catch (error) {
    await child.close().catch(() => undefined);
    throw error;
  }
}

async function readChildFilePrefix(
  parent: FileHandle,
  name: string,
  logicalPath: string,
  length: number,
  onFailure: Failure,
  operations: SafeFilesystemOperations,
): Promise<Buffer> {
  if (!Number.isSafeInteger(length) || length < 1 || length > 64 * 1024) {
    return onFailure('regular file prefix length is outside its bound');
  }
  let file: FileHandle | undefined;
  try {
    const before = await operations.lstat(logicalPath);
    assertRegularFile(before);
    file = await operations.open(
      descriptorChildPath(parent, name),
      regularFileReadFlags(operations),
    );
    const opened = await file.stat();
    const afterOpen = await operations.lstat(logicalPath);
    assertSameRegularFile(before, opened, afterOpen);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, 0);
    await assertOpenFileStillBound(logicalPath, file, opened, operations);
    return buffer.subarray(0, bytesRead);
  } catch (error) {
    return mapFailure(
      error,
      onFailure,
      'regular file prefix could not be read without following links',
    );
  } finally {
    await file?.close().catch(() => undefined);
  }
}

async function assertOpenFileStillBound(
  logicalPath: string,
  handle: FileHandle,
  opened: Stats,
  operations: SafeFilesystemOperations,
): Promise<void> {
  const [afterRead, afterPath] = await Promise.all([handle.stat(), operations.lstat(logicalPath)]);
  assertSameRegularFile(opened, afterRead, afterPath);
  if (afterRead.size !== opened.size) fail('regular file changed while it was read');
}

async function readBoundedHandle(handle: FileHandle, maximumBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maximumBytes - total + 1));
    const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > maximumBytes) fail('regular file grew beyond its byte bound');
    chunks.push(chunk.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, total);
}

function assertTraversalBounds(
  input: Pick<
    Parameters<typeof walkStableWorkspace>[1],
    'maximumDepth' | 'maximumEntriesPerDirectory' | 'maximumTotalEntries'
  >,
  onFailure: Failure,
): void {
  if (
    !Number.isSafeInteger(input.maximumDepth) ||
    !Number.isSafeInteger(input.maximumEntriesPerDirectory) ||
    !Number.isSafeInteger(input.maximumTotalEntries) ||
    input.maximumDepth < 0 ||
    input.maximumEntriesPerDirectory < 1 ||
    input.maximumTotalEntries < input.maximumEntriesPerDirectory
  ) {
    onFailure('workspace traversal bounds are invalid');
  }
}

function assertByteBounds(minimum: number, maximum: number, onFailure: Failure): void {
  if (
    !Number.isSafeInteger(minimum) ||
    !Number.isSafeInteger(maximum) ||
    minimum < 0 ||
    maximum < minimum
  ) {
    onFailure('regular file byte bounds are invalid');
  }
}

function assertSupported(operations: SafeFilesystemOperations, onFailure: Failure): void {
  if (
    operations.platform !== 'linux' ||
    typeof operations.flags.directory !== 'number' ||
    typeof operations.flags.noFollow !== 'number' ||
    typeof operations.flags.nonBlock !== 'number'
  ) {
    onFailure('descriptor-anchored no-follow filesystem inspection is unsupported');
  }
}

function assertRegularFile(metadata: Stats): void {
  if (metadata.isSymbolicLink()) fail('path is a symbolic link');
  if (!metadata.isFile()) fail('path is not a regular file');
}

function assertDirectory(metadata: Stats): void {
  if (metadata.isSymbolicLink()) fail('path is a symbolic link');
  if (!metadata.isDirectory()) fail('path is not a real directory');
}

function assertSameRegularFile(before: Stats, opened: Stats, path: Stats): void {
  assertRegularFile(opened);
  assertRegularFile(path);
  if (!sameIdentity(before, opened) || !sameIdentity(opened, path)) {
    fail('regular file identity changed during no-follow inspection');
  }
}

function assertSameDirectory(
  before: Stats,
  opened: Stats,
  path: Stats,
  compareMutation: boolean,
): void {
  assertDirectory(opened);
  assertDirectory(path);
  if (!sameIdentity(before, opened) || !sameIdentity(opened, path)) {
    fail('directory identity changed during descriptor-anchored enumeration');
  }
  if (
    compareMutation &&
    (before.mtimeMs !== opened.mtimeMs ||
      before.ctimeMs !== opened.ctimeMs ||
      before.size !== opened.size)
  ) {
    fail('directory changed during descriptor-anchored enumeration');
  }
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function regularFileReadFlags(operations: SafeFilesystemOperations): number {
  return operations.flags.readOnly | operations.flags.noFollow! | operations.flags.nonBlock!;
}

function directoryReadFlags(operations: SafeFilesystemOperations): number {
  return regularFileReadFlags(operations) | operations.flags.directory!;
}

function descriptorChildPath(parent: FileHandle, name: string): string {
  if (!name || name.includes(sep) || name === '.' || name === '..') {
    fail('descriptor-relative child name is unsafe');
  }
  return `/proc/self/fd/${parent.fd}/${name}`;
}

function mapFailure(error: unknown, onFailure: Failure, fallback: string): never {
  if (
    error &&
    typeof error === 'object' &&
    'name' in error &&
    error.name === 'ScreenshotPrivacyError'
  ) {
    throw error;
  }
  return onFailure(error instanceof SafeFilesystemFailure ? error.message : fallback);
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

class SafeFilesystemFailure extends Error {}

function fail(message: string): never {
  throw new SafeFilesystemFailure(message);
}
