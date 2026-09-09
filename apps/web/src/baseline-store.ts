import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 as digest } from '@arxic/contracts';

/**
 * Approved baselines, content-addressed and immutable.
 *
 * An approval used to be a pointer into the run directory that produced it, so
 * the baseline's life was tied to that run's: deleting the run, or letting
 * retention expire it, destroyed the reference the next comparison depended on.
 * Retention worked around this by refusing to delete runs a baseline pointed
 * at, which meant a project's disk floor grew with every approval.
 *
 * Here a baseline is a file named by the digest of its own bytes. Approving the
 * same pixels twice writes nothing; the run that produced them can be deleted
 * without touching them; and two projects that happen to render identically
 * share one file. The store never overwrites: identical name means identical
 * content, so a write that would replace an existing entry is a no-op rather
 * than a decision.
 *
 * `ARXIC_BASELINE_STORE` moves the root somewhere durable — an LFS-tracked
 * path, a mounted bucket, a backed-up volume — without changing anything else.
 */
export class BaselineStore {
  readonly root: string;
  readonly external: boolean;

  constructor(stateDirectory: string, env: NodeJS.ProcessEnv = process.env) {
    const supplied = env.ARXIC_BASELINE_STORE?.trim();
    this.external = !!supplied;
    this.root = supplied || join(stateDirectory, 'baselines');
  }

  /** Two-level fan-out: a flat directory of tens of thousands of files is slow to list. */
  private path(sha256: string) {
    return join(this.root, sha256.slice(0, 2), `${sha256}.png`);
  }

  /**
   * Adds bytes to the store under their own digest.
   *
   * Refuses a digest that does not match the bytes: an approval must not be
   * recorded against content the caller mis-identified. Written to a temporary
   * name and renamed, so a crash mid-write cannot leave a truncated file under
   * a digest that promises complete content.
   */
  async promote(bytes: Buffer, sha256: string): Promise<{ stored: boolean; path: string }> {
    if (digest(bytes) !== sha256)
      throw new Error('Baseline bytes do not match the digest they were offered under');
    const target = this.path(sha256);
    if (await this.has(sha256)) return { stored: false, path: target };
    await mkdir(join(this.root, sha256.slice(0, 2)), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${process.pid}.partial`;
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, target);
    return { stored: true, path: target };
  }

  async has(sha256: string): Promise<boolean> {
    try {
      await readFile(this.path(sha256));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns the stored bytes, or undefined when this digest is not held.
   *
   * The digest is re-verified on read. A file that no longer hashes to its own
   * name has been corrupted or replaced, and is treated as absent so the caller
   * falls back rather than comparing against something unknown.
   */
  async read(sha256: string): Promise<Buffer | undefined> {
    try {
      const bytes = await readFile(this.path(sha256));
      return digest(bytes) === sha256 ? bytes : undefined;
    } catch {
      return undefined;
    }
  }
}
