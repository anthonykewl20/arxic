import { readdir, rm, stat, statfs } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Spool retention (spec §13): a strict byte cap with oldest-first eviction,
 * pinned evidence that is never reclaimed, and an honest unreclaimable report
 * instead of silent deletion — callers turn `pinned-exceeds-cap` into
 * backpressure. The spool is flat and operator-owned: only regular files
 * directly inside it are considered, `..` path segments are refused, and
 * nothing outside the spool is ever touched.
 */
export type RetentionEntry = { path: string; bytes: number; ageDays: number };
export type RetentionResult = {
  deleted: RetentionEntry[];
  bytesAfter: number;
  pinnedBytes: number;
  reason: 'pinned-exceeds-cap' | null;
};

const DAY_MS = 86_400_000;

export async function enforceRetention(
  spool: string,
  options: { byteCap: number; pins: string[]; now?: () => number },
): Promise<RetentionResult> {
  const unsafe = (value: string) => value.split(/[\\/]/u).some((part) => part === '..');
  if (unsafe(spool) || resolve(spool) === '/') throw new Error('unsafe-path');
  for (const pin of options.pins)
    if (unsafe(pin) || pin.startsWith('/') || pin === '') throw new Error('unsafe-path');
  const now = options.now ?? Date.now;
  const pinned = new Set(options.pins);

  const entries = await readdir(spool, { withFileTypes: true });
  const files: { name: string; bytes: number; mtimeMs: number }[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue; // directories and symlinks are not spool payloads
    const info = await stat(resolve(spool, entry.name));
    files.push({ name: entry.name, bytes: info.size, mtimeMs: info.mtimeMs });
  }
  const pinnedBytes = files.filter((f) => pinned.has(f.name)).reduce((sum, f) => sum + f.bytes, 0);
  const evictable = files
    .filter((f) => !pinned.has(f.name))
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));

  let total = files.reduce((sum, f) => sum + f.bytes, 0);
  const deleted: RetentionEntry[] = [];
  for (const file of evictable) {
    if (total <= options.byteCap) break;
    await rm(resolve(spool, file.name));
    total -= file.bytes;
    deleted.push({
      path: file.name,
      bytes: file.bytes,
      ageDays: (now() - file.mtimeMs) / DAY_MS,
    });
  }
  return {
    deleted,
    bytesAfter: total,
    pinnedBytes,
    reason: total > options.byteCap ? 'pinned-exceeds-cap' : null,
  };
}

export type FreeReserveResult = {
  ok: boolean;
  availableBytes: number;
  minFreeBytes: number;
  reason: 'disk-reserve-breach' | 'disk-reserve-unavailable' | null;
};

/**
 * Free-reserve gate (spec §13: "Refuse admission before breaching free
 * reserve"): the spool filesystem must keep `minFreeBytes` available to
 * unprivileged writers (bavail × bsize). A filesystem that cannot be stat'd
 * fails closed — admission is refused, never guessed open.
 */
export async function freeReserveOk(
  path: string,
  minFreeBytes: number,
  statfsImpl: typeof statfs = statfs,
): Promise<FreeReserveResult> {
  try {
    const stats = await statfsImpl(path);
    const availableBytes = stats.bavail * stats.bsize;
    return {
      ok: availableBytes >= minFreeBytes,
      availableBytes,
      minFreeBytes,
      reason: availableBytes >= minFreeBytes ? null : 'disk-reserve-breach',
    };
  } catch {
    return { ok: false, availableBytes: 0, minFreeBytes, reason: 'disk-reserve-unavailable' };
  }
}
