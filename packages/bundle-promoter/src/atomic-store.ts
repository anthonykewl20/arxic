import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type { Diagnostic } from '@arxic/contracts';
import {
  ARXIC_PROMOTION_ATOMIC_REPLACE_FAILED,
  ARXIC_PROMOTION_LOCK_CONTENTION,
  promotionDiagnostic,
} from './diagnostics';
import { validateStagedBytes } from './validator';

export type AtomicStoreResult =
  { ok: true; location: string; byteLength: number } | { ok: false; diagnostics: Diagnostic[] };

export async function atomicReplace(
  publicPath: string,
  bytes: Uint8Array,
  expectedSha256: string,
  lockTimeoutMs = 0,
): Promise<AtomicStoreResult> {
  const location = resolve(publicPath);
  const directory = dirname(location);
  const lockPath = `${location}.lock`;
  const stagedPath = `${directory}/.${basename(location)}.${randomUUID()}.stage`;
  const lkgPath = `${location}.lkg`;
  const lkgStagePath = `${directory}/.${basename(location)}.${randomUUID()}.lkg-stage`;
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  try {
    await mkdir(directory, { recursive: true });
    lock = await acquireLock(lockPath, lockTimeoutMs);
    if (!lock) {
      return {
        ok: false,
        diagnostics: [
          promotionDiagnostic(
            ARXIC_PROMOTION_LOCK_CONTENTION,
            location,
            `Exclusive promotion lock was not acquired within ${lockTimeoutMs}ms`,
          ),
        ],
      };
    }
    await writeExclusive(stagedPath, bytes);
    const stagedBytes = await readFile(stagedPath);
    const hashResult = validateStagedBytes(stagedBytes, expectedSha256);
    if (!hashResult.ok) return hashResult;
    if (stagedBytes.byteLength !== bytes.byteLength) {
      return {
        ok: false,
        diagnostics: [
          promotionDiagnostic(
            ARXIC_PROMOTION_ATOMIC_REPLACE_FAILED,
            location,
            'Staged byte count changed before promotion',
          ),
        ],
      };
    }
    try {
      await copyFile(location, lkgStagePath, constants.COPYFILE_EXCL);
      await rename(lkgStagePath, lkgPath);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    await rename(stagedPath, location);
    return { ok: true, location, byteLength: stagedBytes.byteLength };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        promotionDiagnostic(
          ARXIC_PROMOTION_ATOMIC_REPLACE_FAILED,
          location,
          error instanceof Error ? error.message : String(error),
        ),
      ],
    };
  } finally {
    await Promise.allSettled([
      unlink(stagedPath),
      unlink(lkgStagePath),
      lock?.close() ?? Promise.resolve(),
    ]);
    if (lock) await unlink(lockPath).catch(() => undefined);
  }
}

async function writeExclusive(path: string, bytes: Uint8Array): Promise<void> {
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}

async function acquireLock(path: string, timeoutMs: number) {
  const started = Date.now();
  while (true) {
    try {
      return await open(path, 'wx', 0o600);
    } catch (error) {
      if (!isExists(error)) throw error;
      if (Date.now() - started >= timeoutMs) return undefined;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    }
  }
}

function isExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
